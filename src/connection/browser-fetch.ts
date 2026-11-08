/** The T3 transport needs abort, redirect rejection and incremental body reads.
 * requestUrl buffers the whole body and cannot supply these stream semantics.
 * Service traffic belongs to the plugin's main window, not an active popout. */
export const browserFetch:typeof fetch=(input,options)=>window.fetch(input,options);
