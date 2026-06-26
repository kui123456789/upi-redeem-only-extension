# Declare permissions

Source: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
Downloaded: 2026-06-26T05:25:33.621Z

To use most extension APIs and features, you must declare your extension's intent in the manifest's permissions fields. Extensions can request the following categories of permissions, specified using the respective manifest keys:

"permissions"
Contains items from a list of known strings . Changes may trigger a warning .
"optional_permissions"
Granted by the user at runtime, instead of at install time.
"content_scripts.matches"
Contains one or more match patterns that allows content scripts to inject into one or more hosts. Changes may trigger a warning .
"host_permissions"
Contains one or more match patterns that give access to one or more hosts. Changes may trigger a warning .
"optional_host_permissions"
Granted by the user at runtime, instead of at install time.

Permissions help to limit damage if your extension is compromised by malware. Some permission warnings are displayed to users for their consent before installation or at runtime, as detailed in Permission with warnings .

Consider using optional permissions wherever the functionality of your extension permits, to provide users with informed control over access to resources and data.

If an API requires a permission, its documentation explains how to declare it. For an example, see Storage API .

## Manifest

The following is an example of the permissions section of a manifest file:

manifest.json:

```
{ "name" : "Permissions Extension" , ... "permissions" : [ "activeTab" , "contextMenus" , "storage" ], "optional_permissions" : [ "topSites" , ], "host_permissions" : [ "https://www.developer.chrome.com/*" ], "optional_host_permissions" :[ "https://*/*" , "http://*/*" ], ... "manifest_version" : 3 }
```

## Host permissions

Host permissions allow extensions to interact with the URL's matching patterns . Some Chrome APIs require host permissions in addition to their own API permissions, which are documented on each reference page. Here are some examples:

- Make fetch() requests from the extension service worker and extension pages.

- Read and query the sensitive tab properties (url, title, and favIconUrl) using the chrome.tabs API.

- Inject a content script programmatically .

- Monitor and control the network requests with the chrome.webRequest API.

- Access cookies with the chrome.cookies API.

- Redirect and modify requests and response headers using chrome.declarativeNetRequest API.

## Permissions with warnings

When an extension requests multiple permissions, and many of them display warnings on installation, the user will see a list of warnings, like in the following example:

Users are more likely to trust an extension with limited warnings or when permissions are explained to them. Consider implementing optional permissions or a less powerful API to avoid alarming warnings. For best practices for warnings, see Permission warnings guidelines . Specific warnings are listed with the permissions to which they apply in the Permissions reference list.

Adding or changing match patterns in the "host_permissions" and "content_scripts.matches" fields of the manifest file will also trigger a warning . To learn more, see Updating permissions .

## Allow access

If your extension needs to run on file:// URLs or operate in incognito mode, users must give the extension access on its details page. You can find instructions for opening the details page under Manage your extensions .

### Allow access to file URLs and incognito pages

- Right-click the extension icon in Chrome.

- Choose Manage Extension . Extension menu

- Scroll down to enable access to file URLs or incognito mode. Access enabled to file URLs and incognito mode.

To detect whether the user has allowed access, you can call extension.isAllowedIncognitoAccess() or extension.isAllowedFileSchemeAccess() .

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License , and code samples are licensed under the Apache 2.0 License . For details, see the Google Developers Site Policies . Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2024-02-05 UTC.

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],["Last updated 2024-02-05 UTC."],[],[]]
