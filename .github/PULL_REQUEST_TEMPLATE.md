<!--
Please use semantic PR titles that respect this format:

<type>(#<issue number>): <subject>

Quick example:

feat(#1234): add hat wobble
^--^(#^--^): ^------------^
|     |      |
|     |      + - > subject
|     |
|     + -------- > issue number
|
+ -------------- > type: chore, feat, fix, perf.

https://docs.communityhealthtoolkit.org/contribute/code/workflow/#commit-message-format
-->

# Description

<!-- DESCRIPTION -->

<!-- ISSUE NUMBER -->

# Code review checklist
<!-- Remove or comment out any items that do not apply to this PR; in the remaining boxes, replace the [ ] with [x]. -->
- [ ] UI/UX backwards compatible: Test it works for the new design (enabled by default). And test it works in the old design, enable `can_view_old_navigation` permission to see the old design. Test it has appropriate design for RTL languages. 
- [ ] Readable: Concise, well named, follows the [style guide](https://docs.communityhealthtoolkit.org/contribute/code/style-guide/), documented if necessary.
- [ ] Documented: Configuration and user documentation on [cht-docs](https://github.com/medic/cht-docs/)
- [ ] Tested: Unit and/or e2e where appropriate
- [ ] Internationalised: All user facing text
- [ ] Backwards compatible: Works with existing data and configuration or includes a migration. Any breaking changes documented in the release notes.

<!-- COMPOSE URLS GO HERE - DO NOT CHANGE -->

# License

The software is provided under AGPL-3.0. Contributions to this project are accepted under the same license.

