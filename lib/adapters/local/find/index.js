'use strict';

var utils = require('../../../utils');
var getIndexes = require('../get-indexes');

var abstractMapper = require('../abstract-mapper');
var planQuery = require('./query-planner');
var localUtils = require('../utils');
var filterInMemoryFields = require('./in-memory-filter');
var massageSelector = localUtils.massageSelector;
var getValue = localUtils.getValue;
var validateFindRequest = localUtils.validateFindRequest;
var reverseOptions = localUtils.reverseOptions;
var filterInclusiveStart = localUtils.filterInclusiveStart;
var Promise = utils.Promise;

function indexToSignature(index) {
  // remove '_design/'
  return index.ddoc.substring(8) + '/' + index.name;
}

function find(db, requestDef) {

  if (requestDef.selector) {
    requestDef.selector = massageSelector(requestDef.selector);
  }

  validateFindRequest(requestDef);

  return getIndexes(db).then(function (getIndexesRes) {

    var queryPlan = planQuery(requestDef, getIndexesRes.indexes);

    var indexToUse = queryPlan.index;

    var opts = utils.extend(true, {
      include_docs: true,
      reduce: false
    }, queryPlan.queryOpts);

    var isDescending = requestDef.sort &&
      typeof requestDef.sort[0] !== 'string' &&
      getValue(requestDef.sort[0]) === 'desc';

    if (isDescending) {
      // either all descending or all ascending
      opts.descending = true;
      opts = reverseOptions(opts);
    }

    if (!queryPlan.inMemoryFields.length) {
      // no in-memory filtering necessary, so we can let the
      // database do the limit/skip for us
      if ('limit' in requestDef) {
        opts.limit = requestDef.limit;
      }
      if ('skip' in requestDef) {
        opts.skip = requestDef.skip;
      }
    }

    return Promise.resolve().then(function () {
      if (indexToUse.name === '_all_docs') {
        return db.allDocs(opts);
      } else {
        var signature = indexToSignature(indexToUse);
        return abstractMapper.query.call(db, signature, opts);
      }
    }).then(function (res) {

      if (opts.inclusive_start === false) {
        // may have to manually filter the first one,
        // since couchdb has no true inclusive_start option
        res.rows = filterInclusiveStart(res.rows, opts.startkey);
      }

      if (queryPlan.inMemoryFields.length) {
        // need to filter some stuff in-memory
        res.rows = filterInMemoryFields(res.rows, requestDef, queryPlan.inMemoryFields);

        if ('limit' in requestDef || 'skip' in requestDef) {
          // have to do the limit in-memory
          var skip = requestDef.skip || 0;
          var limit = ('limit' in requestDef ? requestDef.limit : res.rows.length) + skip;
          res.rows = res.rows.slice(skip, limit);
        }
      }

      return {
        docs: res.rows.map(function (row) {
          var doc = row.doc;
          if (requestDef.fields) {
            return utils.pick(doc, requestDef.fields);
          }
          return doc;
        })
      };
    });
  });
}

module.exports = find;