# About extension service workers

Source: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers
Downloaded: 2026-06-26T05:25:33.621Z

This section explains what you need to know to use service workers in extensions. You should read this section whether you're familiar with service workers or not. Extension service workers are an extension's central event handler. That makes them just different enough from web service workers that the mountains of service worker articles around the web may or may not be useful.

Extension service workers have a few things in common with their web counterparts. An extension service worker is loaded when it is needed, and unloaded when it goes dormant. Once loaded, an extension service worker generally runs as long as it is actively receiving events, though it can shut down . Like its web counterpart, an extension service worker cannot access the DOM, though you can use it if needed with offscreen documents .

Extension service workers are more than network proxies (as web service workers are often described). In addition to the standard service worker events , they also respond to extension events such as navigating to a new page, clicking a notification, or closing a tab. They're also registered and updated differently from web service workers.

Note: In some contexts here and around the web you will see service workers called "background scripts". Previously, this site often used the terms interchangeably. Manifest V2 also included a feature called a background script. To avoid overloading the term and creating confusion, this section will use "extension service worker" or "service worker" throughout.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License , and code samples are licensed under the Apache 2.0 License . For details, see the Google Developers Site Policies . Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2023-05-03 UTC.

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],["Last updated 2023-05-03 UTC."],[],[]]
