# Extensions / Manifest V3

Source: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
Downloaded: 2026-06-26T05:25:33.621Z

Stay organized with collections

Save and categorize content based on your preferences.

### Manifest V3

Manifest V3 is the latest version of the extensions platform. We have made a number of changes to the available APIs and added a number of new features.

Migrate your extension

## Our Goals

Manifest V3 aims to be the first step in our platform vision to improve the privacy, security, and performance of extensions. Along with the platform changes, we are working to give users more understanding and control over what extensions are capable of. The changes will take several years to complete.

## What changes?

### Moving to service workers

Extensions in Manifest V2 had a long-lived background page that took up resources, even when an extension wasn't running. In Manifest V3, we have moved the background context to service workers, which run only when needed.

Learn more

### No more remotely hosted code

Manifest V3 removes the ability for an extension to use remotely hosted code, which presents security risks by allowing unreviewed code to be executed in extensions. With this change, an extension can only execute JavaScript that is included within its package and subject to review by the Chrome Web Store.

Learn more

### Changes to network request modification

We are deprecating the blocking version of the webRequest API. This required extensions to proxy all network traffic to provide filtering capabilities, which came at a performance and privacy cost. The new declarativeNetRequest API provides a safer alternative for many use cases.

Learn more

### Other changes

Manifest V3 also adds a number of new APIs and capabilities, improvements to the platform including support for promise-based methods, and more.

Learn more

## Where to go from here?

### Migrate

Learn to migrate your extension.

Get started

### Known issues

See key platform gaps we closed as part of the transition.

Learn more

### Checklist

See a checklist of changes for migration.

Learn more

### Publishing guide

Advice on publishing an updated extension.

Learn more

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],[],[],[]]
