function(doc) {
  if (['person', 'clinic', 'health_center', 'district_hospital'].indexOf(doc.type) !== -1) {
    emit([!!doc.muted, doc._id]);
  }
}
