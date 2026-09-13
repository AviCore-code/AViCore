# Company knowledge search

Released in Admin 1.0.236, 7 September 2026.

## Use

Admin: Settings → Admin Setting → Company Knowledge. Sign in as a company admin/owner.
LINE: `AviCore ค้นหา reserve fuel` or `AviCore ค้นหา OPS-CM-01 เวลาพัก`.
Only the configured LINE_PILOT_GROUP_ID can receive company excerpts. Direct chats,
other groups and rooms cannot search this corpus. General greetings/tests remain available.

Every document response includes the requested IQSMS verification note, document code,
revision and physical PDF page. These are retrieved excerpts, not AI-generated answers.

## Data and search

Initial snapshot acquired 6 September 2026: 9 Flight Operations documents, 2,342 PDF pages,
3,191 page-preserving chunks. Codes OPS-CM-01–06, OPS-CP-02/03/05.
This is not the entire company library and there is no automatic IQSMS synchronization.
Image-only tables and pictures are not OCR indexed. Physical PDF page numbers differ
from section page labels printed inside manuals. Verify the original before use.

Supabase Postgres stores documents, page text and vector(384) chunks. Built-in gte-small
generates normalized mean-pooled vectors, without a separate AI API key. Its tokenizer
limits chunks to 384 tokens plus special tokens; overlap is 64 tokens. Observed maximum
in this snapshot is 386 tokens. English lexical and semantic candidate ranks are combined
using reciprocal rank fusion (k=60), with a 0.85 cosine similarity floor for vector candidates.
One chunk per document page is returned, maximum three pages. This threshold is a retrieval
filter, not a calibrated confidence score. Further retrieval evaluation is needed as the
corpus grows. Exact filtered search is adequate for this initial 3,191-chunk corpus; add
and measure a vector ANN index if volume warrants it.

gte-small is English-only. Curated Thai aliases support common topics; arbitrary Thai
questions are not multilingual semantic search. Unmapped Thai input asks for an English
term instead. If model inference fails, the result explicitly labels keyword fallback.

## Security and deployment

RLS and explicit grants protect all three tables. Search RPCs are SECURITY INVOKER.
Anonymous reads and execution are revoked. Authenticated table reads require admin/owner
membership through the document policy. knowledge-search validates the Supabase user JWT
and company membership before using the server client. LINE validates the raw-body HMAC
before routing, then checks the configured group. No browser service key is used.

knowledge-index is an internal operator endpoint. It checks avicore_verify_line_cron
against the existing Vault secret, generates at most four vectors per call, and skips
already completed chunks. `after` describes an ID range (after, after+4]. It also accepts
a query for operator-only retrieval checks. Do not expose the Vault credential in a client.
JWT gateway validation is off on these functions because authentication is implemented
inside each function. Unsigned/unauthenticated live requests were verified to return 401.

Source and import scripts: extract-iqsms-knowledge.py, build-iqsms-import.py,
build-iqsms-chunks.py. Private output is excluded by .gitignore. Keep original SHA/revision
metadata; import new versions inactive, finish page/chunk/vector verification, then switch
the active version atomically. Do not mark documents read/understood on behalf of users.
The chunk builder requires tokenizers==0.21.4 and the Supabase/gte-small tokenizer.json.

## Validation and rollback

16 targeted tests passed (LINE auth/replies/digest/admin test and knowledge routing,
query mapping, fallback, output length/footer). Live backend queries verified reserve fuel,
Thai rest period mapping and an English paraphrase. Anonymous access denied, a nonmember
sees zero chunks. Security advisors reported no new knowledge-schema findings; unrelated
pre-existing platform findings were not modified in this release. PDF sample text was
compared with rendered originals; an image table confirmed the OCR limitation.

Firebase build/deploy succeeded. The live login page shows 1.0.236. The authenticated
Admin UI was not clicked through because no active Admin browser session was available.

To disable document results quickly, set active=false for this company's KB documents.
For a code regression, redeploy the prior webhook version and Firebase Hosting release;
due-date cron configuration is independent. Preserve the corpus for diagnosis.
