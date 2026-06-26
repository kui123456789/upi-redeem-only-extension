# Storage and cookies

Source: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
Downloaded: 2026-06-26T05:25:33.621Z

Extensions can store cookies and access web storage APIs similarly to a normal website. However, in some cases these behave differently in extensions.

See chrome.storage for information on the extension API.

## Storage

It is often desirable to use web platform storage APIs in extensions. This section explores the behavior of these APIs in an extension context, which can sometimes differ with how they behave on the web.

### Persistence

Extension storage is not cleared when a user clears browsing data . This applies to any data stored using web storage APIs (such as Local Storage and IndexedDB ).

By default, extensions are subject to the normal quota restrictions on storage, which can be checked by calling navigator.storage.estimate() . Storage can also be evicted under heavy memory pressure, although this is rare. To avoid this:

- Request the "unlimitedStorage" permission, which affects both extension and web storage APIs and exempts extensions from both quota restrictions and eviction.

- Call navigator.storage.persist() for protection against eviction.

Extension storage is shared across the extension's origin including the extension service worker, any extension pages (including popups and the side panel), and offscreen documents. In content scripts, calling web storage APIs accesses data from the host page the content script is injected on and not the extension.

### Access in service workers

The IndexedDB and Cache Storage APIs are accessible in service workers. However, Local Storage and Session Storage are not.

If you need to access Local Storage or Session Storage from the service worker, use an offscreen document .

### Partitioning

Partitioning is where keys are introduced for stored data to limit where it can be accessed. Storage has historically been keyed by origin.

Starting in Chrome 115, storage partitioning introduces changes to how partitioning keys are defined to prevent certain types of cross-site tracking. In practice, this means that if site A embeds an iframe containing site B, site B won't be able to access the same storage it would usually have when navigated to directly.

To mitigate the impact of this in extensions, two exemptions apply:

- If a page with the chrome-extension:// scheme is embedded in any site, storage partitioning won't apply, and the extension will have access to its top-level partition.

- If a page with the chrome-extension:// scheme includes an iframe, and the extension has host permissions for the site it is embedding, that site will also have access to its top-level partition.

## Cookies

Cookies provide a way to store key-value pairs associated with a specific domain and path. They have limited value in extensions but understanding their behavior can be useful if you have a specific use case or have bundled a third-party script which uses them in its implementation.

### Secure cookies

The Secure cookie attribute is only supported for the https:// scheme. Consequently, chrome-extension:// pages are not able to set cookies with this attribute.

This also means that extension pages cannot use other cookie attributes where the Secure attribute is required:

- SameSite=None

- Partitioned

### Partitioning and SameSite behavior

Note: When an extension embeds a third-party site, that site will use the extension origin as the partition key. This means the site won't be able access the same cookies as if it were navigated to directly. See https://crbug.com/1463991 .

Cookies set on chrome-extension:// pages always use SameSite=Lax . Consequently, cookies set by an extension on its own origin can never be accessed in frames and partitioning is not relevant.

For cookies associated with third-party sites, such as for a third-party site loaded in a frame on an extension page, or a request made from an extension page to a third-party origin, cookies behave the same as the web except in two ways:

- Third-party cookies are never blocked even in subframes if the top-level page for a given tab is a chrome-extension:// page.

- Requests from an extension to a third-party are treated as same-site if the extension has host permissions for the third-party. This means SameSite=Strict cookies can be sent. Note that this only applies to network requests, not access through document.cookie in JavaScript, and does not apply if third-party cookies are blocked.

Note that settings around third-party cookies are affected by the Privacy Sandbox work and are adjusted according to its timeline .

The chrome.cookies API provides control over the partition key to use with each API method. For more information, see the API reference .

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License , and code samples are licensed under the Apache 2.0 License . For details, see the Google Developers Site Policies . Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-09-28 UTC.

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],["Last updated 2023-09-28 UTC."],[],[]]
