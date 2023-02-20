// Various methods to work with Notion API

import axios, { AxiosInstance } from 'axios'
import _ from 'lodash'
import pluralize from 'pluralize'

// console.log(_)

const { chain, camelCase, keys } = _

export interface NotionOptions {
  debug?: boolean
  baseURL?: string
  ignoreTokenWarnings?: boolean
}

export interface IDatabase {
  database_id: string
}

type Content = any;
type Data = Record<string, any>;

// function Notion(token = process.env.NOTION_TOKEN, { baseURL = process.env.NOTION_API_URL, debug = false } = {} ) {
export default class Notion {


  // console.log({ debug, token, baseURL })

  // let api = axios.create({
  //   baseURL,
  //   headers: {
  //     ...token ? {
  //       Authorization: `Bearer ${token}`,
  //       'Notion-Version': '2022-02-22'
  //     } : {}
  //   }
  // })

  // console.log( 'API:', api )

  token?: string
  api: AxiosInstance

  constructor(token?: string, options: NotionOptions = {} ) {

    let { debug, baseURL, ignoreTokenWarnings } = options

    if ( !ignoreTokenWarnings) {
      if ( !token ) {
        console.warn('No token provided. The API won\'t work unless you create your own server/proxy that has the same interface as Notion API and accepts non-authenticated requests.')
      } else {
        // If this is a browser environment, throw an error because it is insecure to expose the token to the client
        if ( typeof window !== 'undefined' ) {
          throw new Error('Notion API token should not be exposed to the client. Please either move all API calls to the server or use a proxy that accepts non-authenticated requests. If you are sure you want to do this, pass `ignoreTokenWarnings: true` to the constructor.')
        }
      }
    }

    debug ??= false
    baseURL ??= process.env?.NOTION_API_URL ?? 'https://api.notion.com/v1/'
    this.api = axios.create({
      baseURL,
      headers: {
        ...token ? {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-02-22'
        } : {}
      }
    })

    this.token = token

    if ( debug ) {
      console.log( 'Notion instance created:', this )
    }

  }
  
  // Object.assign(this, {

    // Create page
    // async createPage({ parent, properties, titleProp, content }) {
    async createPage(options: {
      parent: IDatabase,
      properties: Data,
      titleProp?: string,
      content?: Content
    }): Promise<Data> {

      let { parent, properties, titleProp, content } = options

      let {
        data
      } = await this.api.post('pages', {
        parent,
        ...notionize({ properties, content, titleProp })
      })

      data = denotionize(data)

      return data

    }

    // Update page
    // async updatePage(id, { properties, content }) {
    async updatePage(id: string, options: {
      properties: Data,
      content?: Content
    }): Promise<Data> {

      let { properties, content } = options

      let {
        data
      } = await this.api.patch(`pages/${id}`,
        notionize({ properties, content })
      )

      data = denotionize(data)

      return data

    }

    // Delete block
    // async deleteBlock(id) {
    async deleteBlock(id: string): Promise<any> {

      let { data } = await this.api.delete(`blocks/${id}`)

      return data

    }

    // Get page
    // async getPage(id) {
    async getPage(id: string): Promise<Data> {

      let {
        data
      } = await this.api.get(`pages/${id}`)

      data = denotionize(data)

      // console.log(`Page ${id} fetched:`, data)

      return data

    }

    // Get token owner info
    // async getUser() {
    async getUser(): Promise<any> {

      // If no token, throw error
      if ( !this.token ) {
        throw new Error('No token provided. Please use an instance of Notion with a token.')
      }

      return (
        await this.api.get('users/me')
      ).data

    }

    // query a database
    // async queryDatabase(databaseId, query, { unwrap: unwrapKeys } = {} ) {
    async queryDatabase(databaseId: string, query: any, options: {
      unwrap?: string[]
    } = {} ): Promise<Data[]> {

      let { unwrap: unwrapKeys } = options

      let data = (
        await this.api.post(`databases/${databaseId}/query`, query)
      ).data.results.map(denotionize)

      // console.log(`Database ${databaseId} queried:`, data)

      if ( unwrapKeys ) {
        await this.unwrap(data, unwrapKeys)
      }

      return data

    }

    // Get page by name
    // async getPageBy(databaseId, filter ) {
    async getPageBy(databaseId: string, filter: Record<string, string | number>): Promise<Data> {
      let key = keys(filter)[0]
      let value = filter[key]
      return ( 
        await this.queryDatabase(databaseId, {
          filter: {
            property: _.startCase(key),
            title: {
              equals: value
            }
          }
        })
      )?.[0]
    }

    // get a block
    // async getBlock(blockId, { recurse = false } = {}) {
    async getBlock(blockId: string, options: {
      recurse?: boolean
    } = {}): Promise<any> {

      let { recurse = false } = options

      let { data, data: { has_children } } = await this.api.get(`blocks/${blockId}`)

      if ( has_children ) {
        data.children = await this.getBlockChildren(blockId, { recurse })
      }

      return data

    }

    // get block children
    // async getBlockChildren(blockId, { recurse = false } = {}) {
    async getBlockChildren(blockId: string, options: {
      recurse?: boolean
    } = {}): Promise<any[]> {

      let { recurse = false } = options

      let { data: { results }} = await this.api.get(`blocks/${blockId}/children`)

      if ( recurse )
        await Promise.all(
          results.map( async (result: any) => {
            let { has_children } = result
            if ( has_children ) {
              result.children = await this.getBlockChildren(result.id, { recurse })
            }
            return result
          })
        )
      
      return results

    }

    // async unwrap(data, unwrapKeys) {
    async unwrap(data: Data[], unwrapKeys: string[]): Promise<void[]> {
      // Fetches complete page data for pages that only contain the id

      let cache: Record<string, Promise<Data>> = {}
      let promises: any[] = []
    
      // For all keys that represent a relation, get the related page
      for (let result of data) {
    
        for (let key of unwrapKeys) {
          let items = result[key]

          // If it's not an array, make it one
          if ( !Array.isArray(items) )
            items = [items]

          // console.log('Items:', items)
              
          promises.push(Promise.all(items.map(async (item: any) => {
    
            // console.log('item:', item)
            let { id }: { id: string } = item

            if ( !id ) {
              console.log('No id found for item:', item)
              return
            }
    
            // If there was no request to get this page yet, get & cache it
            cache[id] = cache[id] || this.getPage(id)
            // console.log('cache:', cache)
    
            // Get the page from the cache (or the request)
            let page = await cache[id]
            // console.log('page:', page)
            delete item.id
            _.assign(item, page)
    
            // console.log('modified item:', item)
    
          })))
    
        }
      }
    
      return Promise.all(promises)
    
    }
        

  // })

}

// function notionize({ properties, titleProp = 'name', content }) {
export function notionize(config: {
  properties: Data,
  titleProp?: string,
  content?: Content
}): any {

  let { properties, titleProp = 'name', content } = config

  let jsonKeys: string[] = []

  return {

    properties: chain(properties)
      .mapValues((value, key) => {
        
        // Number
        if (typeof value === 'number') {

          return {
            number: value
          }

        }

        // Boolean = checkbox
        else if ( typeof value === 'boolean' ) {

          return {
            checkbox: value
          }

        }

        // String
        else if (typeof value === 'string') {

          return {
            [ key === titleProp ? 'title' : 'rich_text' ]: [{ 
              text: {
                content: value 
              }
            }]
          }

        } else {

          let isJsonObject = value?.json

          if ( isJsonObject ) {
            jsonKeys.push(key)
          }

          return isJsonObject ? {
            rich_text: [{
              text: {
                content: `"${JSON.stringify(value.json)}`
              }
            }] 
          } : value

        }

      })
      .mapKeys((value, key) => {

        if ( jsonKeys.includes(key) ) {
          key += ' JSON'
        }

        // Upper first + space between every lower and upper letter
        key = _.startCase(key)

        return key

      })
      .value(),

    ...content ? {
      children: content.plain && (
        content = (
          typeof content.plain === 'string' ? content.plain : JSON.stringify(content.plain, null, 2)
        ).split(/\n+/),
        content.map( (line: string) => ({
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: {
                content: line
              }
            }]
          }
        }) )
      )
    } : {}

  }
}

// function denotionize(data, { propKey = 'properties', unwrap } = {} ) {
export function denotionize(data: Data, options: {
  propKey?: string,
  unwrap?: string[]
} = {}): any {

  let { propKey = 'properties', unwrap } = options

  let jsonKeys: string[] = []

  data = {
    raw: data,
    ...chain(data[propKey])
      .mapKeys( ( value, key: string ) => {
        key = camelCase(key)
        if ( key.endsWith('Json') ) {
          let type = 'object'
          key = key.replace(/Json$/, '')
          jsonKeys.push(key)
        }
        return key
      })
      .mapValues( ( object, key ) => {

        const extract = (object: any): any =>
          object?.type ?
            object.type == 'select' ?
              object.select?.name
              : object.type == 'relation' ?
                // If the key is in singular, get the first item only
                pluralize.isSingular(key) ?
                  object.relation?.[0]
                  : object.relation
                : extract(object[object.type])
            : object

        let value = extract(object)
        // console.log({ object, value })

        if ( ['title', 'rich_text'].includes(object.type) ) {
          value = value[0]?.plain_text

          if ( jsonKeys.includes(key) ) {
            value = JSON.parse(value || null)
          }
        }

        return value

      } )
      .value()
  }

  // console.log( 'denotionized data:', data )

  return data

}

// Notion.anon = new Notion()
export const anon = new Notion(
  undefined,
  { ignoreTokenWarnings: true }
)

// console.log('vovas-notion loaded')

