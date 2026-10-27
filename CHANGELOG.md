# Changelog

## 0.3.1 - 2026-10-27

### Fixed

- Prefer Electron's native filesystem reads for ASAR contents, preserving the
  static archive reader for ordinary Node.js CLI use. This avoids incorrectly
  reporting every selected bundle as unresolved inside DSH Desktop.
- Declare the static composition engine's Cordis and loader dependencies directly.
  The scanner can now load when the installer disables automatic peer dependency
  installation, as DSH profiles may do.
- Publish a new package version for these fixes so version-based market update
  checks can distinguish this release from 0.3.0.

### Validation

- Added a regression check that imports the scanner using only declared production
  dependencies, without automatically installing any peer dependencies.

This remains a static checker. Dynamic configuration and runtime plugin behavior
may require further inspection; an `incomplete` result is not a clean bill of health.
