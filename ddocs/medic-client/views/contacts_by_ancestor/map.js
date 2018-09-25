function(doc) {
  if (['person', 'clinic', 'health_center', 'district_hospital'].indexOf(doc.type) !== -1) {
    var parent = doc;
    while (parent) {
      if (parent._id) {
        emit(parent._id, doc._id);
      }
      parent = parent.parent;
    }
  }
}
