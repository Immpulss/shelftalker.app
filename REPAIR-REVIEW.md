# ShelfTalker lookup repair — review branch only

No production deployment is authorized. Do not merge this branch until review and device checks are complete.

## Changes
- ISBN checksum validation; matching Google Books results; Open Library edition-to-work descriptions; exact normalized title/author fallbacks in both sources.
- Request timeouts and one retry for transient failures; successful lookups cached for the current page session.
- Source description kept separately from the shelf-talker, with an optional paste field.
- Successful repeated ISBN blur no longer clears the book. Old async lookup results cannot replace a newer book.
- Generation disabled during lookup; stale generation results ignored; 260-character check before queueing.
- Printable text escaped before insertion into HTML. Scanner ignores repeated successful callbacks while stopping.
- Existing card dimensions, PDF export, and queue flow retained. Queue autosave is deferred.

## Verification
Run `node --test *.test.cjs` (Node 18+). Nine frontend tests pass, including delayed lookup ordering and description handoff.
The separate backend branch has six passing HTTP tests using a mocked AI service.

Live source probes: all three supplied ISBNs had Open Library edition records without descriptions. The linked work for The Mysterious Benedict Society supplied a description; the queried Uproar and The Widow works did not. Google Books unauthenticated queries returned 429; queries with the existing public application key returned no items in this environment. These probes do not establish what a user's browser will receive.

## Remaining before deployment
- Actual browser/mobile testing: barcode camera permissions, scan/close/reopen, consecutive scans, slow/failing network, editing and deleting cards.
- Download PDF and physical printing: 1, 5, 6 and 10 cards; long titles; existing dimensions and page breaks.
- Real AI quality/cost checks using the test backend, without exposing its key. No live AI calls were made in this repair round.
- The headless browser could not be installed in this environment (download was not a valid archive); browser/PDF checks are NOT claimed as passed.
- Review restrictions on the existing public Google Books API key. It is preserved, not rotated. OpenAI secrets remain backend-only.

The frontend still uses the production summary URL until an explicitly approved test backend is provided. Unit tests mock that URL. Opening this branch as a working page and clicking Generate would call the production API; do not describe it as a fully isolated hosted preview.
