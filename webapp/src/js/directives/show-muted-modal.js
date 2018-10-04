angular.module('inboxDirectives').directive('showMutedModal', function($parse, $state, Modal) {
  return {
    restrict: 'A',
    link: function(scope, element, attrs) {
      var goToState = function() {
        var toState = attrs.toState,
            toStateParams = $parse(attrs.toStateParams)(scope);

        $state.go(toState, toStateParams);
      };

      var hookFn = function() {
        if (scope.form.showUnmuteModal) {
          return Modal({
            templateUrl: 'templates/modals/contacts_muted_modal.html',
            controller: 'ContactsMutedModalCtrl'
          }).then(function() {
            goToState();
          });
        } else {
          goToState();
        }
      };

      element[element.on ? 'on' : 'bind']('click', hookFn);
    }
  };
});
