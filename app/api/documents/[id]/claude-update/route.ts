// Compatibility route: generation now returns an unsaved draft.
// Clients must explicitly POST the accepted HTML to /versions.
export { POST, maxDuration } from '../draft/route'
