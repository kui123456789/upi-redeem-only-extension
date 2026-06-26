# Match patterns

Source: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
Downloaded: 2026-06-26T05:25:33.621Z

A match pattern is a URL with the following structure, used to specify a group of URLs:

```
:// /

``` scheme : Must be one of the following, separated from the rest of the pattern using a colon followed by a double slash ( :// ):

- http

- https

- A wildcard * , which matches only http or https

- file

For information on injecting content scripts into unsupported schemes, such as about: and data: , see Injecting in related frames .

host : A hostname ( www.example.com ). A * before the hostname to match subdomains ( *.example.com ), or just a wildcard * . - If you use a wildcard in the host pattern, it must be the first or only character, and it must be followed by a period ( . ) or forward slash ( / ).

path : A URL path ( /example ). For host permissions, the path is required but ignored. The wildcard ( /* ) should be used by convention.

Extensions use match patterns in a variety of use cases, including the following:

- Injecting content script .

- Declaring host permissions that some Chrome APIs require in addition to their own permissions.

- Granting access to web-accessible resources .

- Allowing message sending and receiving using the "externally_connectable.matches" manifest key.

## Special cases

"<all_urls>"
Matches any URL that starts with a permitted scheme, including any pattern listed under valid patterns . Because it affects all hosts, Chrome web store reviews for extensions that use it may take longer .
"file:///"
Allows your extension to run on local files. This pattern requires the user to manually grant access . Note that this case requires three slashes, not two.
Localhost URLs and IP addresses
To match any localhost port during development, use http://localhost/* . For IP addresses, specify the address plus a wildcard in the path, as in http://127.0.0.1/* . You can also use http://*:*/* to match localhost, IP addresses, and any port.
Top Level domain match patterns
Chrome doesn't support match patterns for top Level domains (TLD) . Specify your match patterns within individual TLDs, as in http://google.es/* and http://google.fr/* .

## Example patterns

https://*/* or https://*/
Matches any URL using the https scheme.
https://*/foo*
Matches any URL using the https scheme, on any host, with a path that starts with foo . Examples of matches include https://example.com/foo/bar.html and https://www.google.com/foo .
https://*.google.com/foo*bar
Matches any URL using the https scheme, on a google.com host, with a path that starts with foo and ends with bar . Examples of matches include https://www.google.com/foo/baz/bar and https://docs.google.com/foobar .
file:///foo*
Matches any local file whose path starts with foo . Examples of matches include file:///foo/bar.html and file:///foo .
http://127.0.0.1/* or http://127.0.0.1/
Matches any URL that uses the http scheme and is on the host 127.0.0.1. Examples of matches include http://127.0.0.1/ and http://127.0.0.1/foo/bar.html .
http://localhost/*
Matches any localhost port.
*://mail.google.com/ or *://mail.google.com/*
Matches any URL that starts with http://mail.google.com or https://mail.google.com .

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License , and code samples are licensed under the Apache 2.0 License . For details, see the Google Developers Site Policies . Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2012-09-18 UTC.

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],["Last updated 2012-09-18 UTC."],[],[]]
