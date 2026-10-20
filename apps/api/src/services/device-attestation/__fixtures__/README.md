# Device attestation fixtures

## Apple App Attest

`apple-attestation-production.json` and `apple-attestation-development.json`
are real App Attest key attestations recorded on devices by the
[node-app-attest](https://github.com/uebelack/node-app-attest) project
(`test/fixtures/`), App ID `V8H6LQ9448.io.uebelacker.AppAttestExample`. Their
credential certificates were valid during 2024, so tests pin `now` to that
year. Used under the MIT License:

> Copyright (c) 2024 David Übelacker
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Play Integrity

`play-integrity-verdict.json` is a decoded standard-request verdict
(`tokenPayloadExternal`) in the shape Google documents. Play Integrity tokens
are encrypted for Google's servers, so the API never decodes one itself; the
fixture stands in for what `decodeIntegrityToken` returns.
