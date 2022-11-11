function(doc) {
  // comment
  if (doc.type === 'feedback') {
    emit(doc.meta.time);
  }
}
