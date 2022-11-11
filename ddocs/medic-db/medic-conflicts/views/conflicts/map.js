function(doc) {
  // comment
  if (doc._conflicts) {
    emit(doc._conflicts);
  }
}
