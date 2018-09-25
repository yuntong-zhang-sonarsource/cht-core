
var getMutedStateById = function(DB, id) {
  var options = {
    start_key: [id],
    end_key: [id, {}]
  };

  return DB
    .query('medic-client/docs_by_id_lineage', options)
    .then(function(results) {
      var keys = results.rows.map(function(row) {
        return [true, row.value._id];
      });

      return DB
        .query('medic-client/contact_by_muted_flag', { keys: keys })
        .then(function(result) {
          return result.rows.some(function(row) {
            return row.value;
          });
        });
    });
};

var getMutedState = function(doc) {
  var isMutedInLineage = function(doc) {
    return doc && (doc.muted || isMutedInLineage(doc.parent));
  };

  return isMutedInLineage(doc);
};

var getMutedContactsIds = function(DB) {

};

module.exports = {
  getMutedStateById: getMutedStateById,
  getMutedState: getMutedState,
  getMutedContactsIds: getMutedContactsIds
};
