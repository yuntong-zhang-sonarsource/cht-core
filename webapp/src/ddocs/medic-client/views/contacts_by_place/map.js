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

  var types = [ 'district_hospital', 'health_center', 'clinic', 'person' ];
  var idx = types.indexOf(doc.type);
  if (idx !== -1) {
    var place = doc.parent;
    var order = idx + ' ' + (doc.name && doc.name.toLowerCase());
    while (place) {
      if (place._id) {
        emit([ place._id ], order);
      }
      place = place.parent;
    }
  }
}
