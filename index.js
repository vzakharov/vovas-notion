// Various methods to work with Notion API

console.log('Starting vovas-notion...')

// axios
import axios from 'axios'

// lodash
import _ from 'lodash'

const { 
  chain, camelCase, upperFirst, keys
} = _

import {
  isSingular, pluralize
} from 'pluralize'

function Notion(token = process.env.NOTION_TOKEN, baseURL = process.env.NOTION_API_URL) {

  console.log({ token, baseURL })
  let api = axios.create({
    baseURL,
    headers: {
      ...token ? {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-02-22'
      } : {}
    }
  })
  
  Object.assign(this, {

    // Create page
    async createPage({ parent, properties, content }) {

      let {
        data
      } = await api.post('pages', {
        parent,
        ...notionize({ properties, content })
      })

      data = denotionize(data)

      return data

    },

    // Update page
    async updatePage(id, { properties, content }) {

      let {
        data
      } = await api.patch(`pages/${id}`,
        notionize({ properties, content })
      )

      data = denotionize(data)

      return data

    },

    // Delete block
    async deleteBlock(id) {

      let { data } = await api.delete(`blocks/${id}`)

      return data

    },

    // Get page
    async getPage(id) {

      let {
        data
      } = await api.get(`pages/${id}`)

      data = denotionize(data)

      console.log(`Page ${id} fetched:`, data)

      return data

    },

    // Get token owner info
    async getUser() {

      // If no token, throw error
      if ( !token ) {
        throw new Error('No token provided. Please use an instance of Notion with a token.')
      }

      return (
        await api.get('users/me')
      ).data

    },

    // query a database
    async queryDatabase(databaseId, query, { unwrap: unwrapKeys } = {} ) {
      let data = (
        await api.post(`databases/${databaseId}/query`, query)
      ).data.results.map(denotionize)

      console.log(`Database ${databaseId} queried:`, data)

      if ( unwrapKeys ) {
        await this.unwrap(data, unwrapKeys)
      }

      return data

    },

    // Get page by name
    async getPageBy(databaseId, filter ) {
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
    },

    // get a block
    async getBlock(blockId, { recurse = false } = {}) {

      let { data, data: { has_children } } = await api.get(`blocks/${blockId}`)

      if ( has_children ) {
        data.children = await this.getBlockChildren(blockId, { recurse })
      }

      return data

    },

    // get block children
    async getBlockChildren(blockId, { recurse = false } = {}) {

      let { data: { results }} = await api.get(`blocks/${blockId}/children`)

      if ( recurse )
        await Promise.all(
          results.map( async result => {
            let { has_children } = result
            if ( has_children ) {
              result.children = await this.getBlockChildren(result.id, { recurse })
            }
            return result
          })
        )
      
      return results

    },

    async unwrap(data, unwrapKeys) {
      // Fetches complete page data for pages that only contain the id

      let cache = {}
      let promises = []
    
      // For all keys that represent a relation, get the related page
      for (let result of data) {
    
        for (let key in unwrapKeys) {
          let items = result[key]

          // If it's not an array, make it one
          if ( !Array.isArray(items) )
            items = [items]
              
          promises.push(Promise.all(items.map(async (item) => {
    
            console.log('item:', item)
    
            // If there was no request to get this page yet, get & cache it
            cache[item.id] = cache[item.id] || this.getPage(item.id)
            console.log('cache:', cache)
    
            // Get the page from the cache (or the request)
            let page = await cache[item.id]
            console.log('page:', page)
            delete item.id
            _.assign(item, page)
    
            console.log('modified item:', item)
    
          })))
    
        }
      }
    
      return Promise.all(promises)
    
    }
        

  })

}

function notionize({ properties, content }) {

  let jsonKeys = []

  return {

    properties: chain(properties)
      .mapValues((value, key) => {
        
        if (typeof value === 'number') {
          return {
            number: value
          }
        }

        else {
          let isObject = value && typeof value === 'object'

          if ( isObject ) {
            jsonKeys.push(key)
          }

          return {
            [key === 'name' ? 'title' : 'rich_text']: [{
              text: {
                content: isObject ? JSON.stringify(value) : value
              }
            }]
          }
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

    children: content.plain && (
      content = (
        typeof content.plain === 'string' ? content.plain : JSON.stringify(content.plain, null, 2)
      ).split(/\n+/),
      content.map( line => ({
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

  }
}

function denotionize(data, { propKey = 'properties', unwrap } = {} ) {

  let jsonKeys = []

  data = {
    raw: data,
    ...chain(data[propKey])
      .mapKeys( ( value, key ) => {
        key = camelCase(key)
        if ( key.endsWith('Json') ) {
          let type = 'object'
          key = key.replace(/Json$/, '')
          jsonKeys.push(key)
        }
        return key
      })
      .mapValues( ( object, key ) => {

        const extract = object =>
          object?.type ?
            object.type == 'select' ?
              object.select?.name
              : object.type == 'relation' ?
                // If the key is in singular, get the first item only
                isSingular(key) ?
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

  console.log( 'denotionized data:', data )

  return data

}


Notion.anon = new Notion()

console.log('vovas-notion loaded')

export default Notion