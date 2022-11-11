function(doc) {
  // comment
  if (doc.type === 'task:outbound') {
    emit();
  }
}
