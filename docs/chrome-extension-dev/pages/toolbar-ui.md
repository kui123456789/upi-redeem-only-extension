# Implement an action

Source: https://developer.chrome.com/docs/extensions/develop/ui/implement-action
Downloaded: 2026-06-26T05:25:33.621Z

An action is what happens when a user clicks the toolbar icon, usually called the action icon for your extension. An action invokes an extension feature using the Action API or opens a popup . This page shows how to invoke an extension feature. To use a popup, see Add a popup .

## Register the action

To use the chrome.action API , add the "action" key to the extension's manifest file. See the manifest section of the chrome.action API reference for a full description of the optional properties of this field.

manifest.json:

```
{ "name" : "My Awesome action Extension" , ... "action" : { ... } ... }
```

## Respond to the action

Register an onClicked handler for when the user clicks the action icon. This event is not triggered if a popup is registered in the manifest.json file.

service-worker.js:

```
chrome.ac t io n .o n Clicked.addLis tener (( ta b) = > { chrome.ac t io n .se t Ti tle ( { ta bId : ta b.id , t i tle : `You are o n ta b : $ { ta b.id } ` } ); } );
```

## Activate the action conditionally

The chrome.declarativeContent API lets you enable the extension's action icon based on the page URL or when CSS selectors match the elements on the page. When an extension's action icon is disabled, the icon is grayed out. If the user clicks the disabled icon, the extension's context menu appears.

A disabled action icon.

## Action badge

Badges are bits of formatted text placed on top of the action icon to indicate such things as extension state or that actions are required by the user. To demonstrate this, the Drink Water sample displays a badge with "ON" to show the user they have successfully set an alarm and displays nothing when the extension is idle. Badges can contain up to four characters.

An extension icon with a badge (left) and without a badge (right).

Set the text of the badge by calling chrome.action.setBadgeText() and the background color by calling chrome.action.setBadgeBackgroundColor() .

service-worker.js:

```
chrome.ac t io n .se t BadgeTex t ( { te x t : 'ON' } ); chrome.ac t io n .se t BadgeBackgrou n dColor( { color : '# 4688 F 1 ' } );
```

## Tooltip

Register tooltips in the "default_title" field under the "action" key in the manifest.json file.

manifest.json:

```
{ "name" : "Tab Flipper" , ... "action" : { "default_title" : "Press Ctrl(Win)/Command(Mac)+Shift+Right/Left to flip tabs" } ... }
```

You can also set or update tooltips by calling action.setTitle() . If no tooltip is set, the name of the extension displays.

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License , and code samples are licensed under the Apache 2.0 License . For details, see the Google Developers Site Policies . Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2024-01-15 UTC.

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],["Last updated 2024-01-15 UTC."],[],[]]
