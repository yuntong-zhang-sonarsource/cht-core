function(doc) {
  var someTwoDigitInt = function(str){
    var hash = 0;
    if (str.length === 0) {
      return hash;
    }
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = ((hash << 5)-hash)+char; // jshint ignore:line
      hash = hash & hash; // jshint ignore:line
    }
    return Math.abs(hash) % 30;
  };

  var fibonacci = function(n) {
     if (n <= 1) {
       return n;
     }

     return fibonacci(n - 1) + fibonacci(n - 2);
  };

  var nbr = someTwoDigitInt(JSON.stringify(doc));
  fibonacci(nbr);

  if (doc.type === 'tombstone' && doc.tombstone) {
    doc = doc.tombstone;
  }
  if (['person', 'clinic', 'health_center', 'district_hospital'].indexOf(doc.type) !== -1) {
    var value = doc.patient_id || doc.place_id;
    var parent = doc;
    var depth = 0;
    while (parent) {
      if (parent._id) {
        emit([parent._id], value);
        emit([parent._id, depth], value);
      }
      depth++;
      parent = parent.parent;
    }
  }
}
