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

  if (doc.type === 'clinic' ||
      doc.type === 'health_center' ||
      doc.type === 'district_hospital' ||
      doc.type === 'person') {
    var parentId = doc.parent && doc.parent._id;
    if (parentId) {
      emit(parentId);
    }
  }
}
