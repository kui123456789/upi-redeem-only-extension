# Content scripts

Source: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
Downloaded: 2026-06-26T05:25:33.621Z

Content scripts are files that run in the context of web pages. Using the standard Document Object Model (DOM), they are able to read details of the web pages the browser visits, make changes to them, and pass information to their parent extension.

## Understand content script capabilities

Content scripts can access the following extension APIs directly:

- dom

- i18n

- storage

- runtime.connect()

- runtime.getManifest()

- runtime.getURL()

- runtime.id

- runtime.onConnect

- runtime.onMessage

- runtime.sendMessage()

Content scripts are unable to access other APIs directly. But they can access them indirectly by exchanging messages with other parts of your extension.

You can also access other files in your extension from a content script, using APIs like fetch() . To do this, you need to declare them as web-accessible resources . Note that this also exposes the resources to any first-party or third-party scripts running on the same site.

## Work in isolated worlds

Content scripts live in an isolated world, allowing a content script to make changes to its JavaScript environment without conflicting with the page or other extensions' content scripts.

Key term: An isolated world is a private execution environment that isn't accessible to the page or other
extensions. A practical consequence of this isolation is that JavaScript variables in an extension's
content scripts are not visible to the host page or other extensions' content scripts. The concept
was originally introduced with the initial launch of Chrome, providing isolation for browser tabs.

An extension may run in a web page with code similar to the following example.

webPage.html

```
click me var greeting = "hello, "; var button = document.getElementById("mybutton"); button.person_name = "Bob"; button.addEventListener( "click", () => alert(greeting + button.person_name + "."), false);
```

That extension could inject the following content script using one of the techniques outlined in the Inject scripts section.

content-script.js

```
var greeting = "hola, " ; var button = document . getElementById ( "mybutton" ); button . person_name = "Roberto" ; button . addEventListener ( "click" , () = > alert ( greeting + button . person_name + "." ), false );
```

With this change, both alerts appear in sequence when the button is clicked.

Note: Not only does each extension run in its own isolated world, but content scripts and the web page do
too. This means that none of these (web page, content scripts, and any running extensions) can
access the context and variables of the others.

## Inject scripts

Content scripts can be declared statically , declared dynamically , or programmatically injected .

### Inject with static declarations

Use static content script declarations in manifest.json for scripts that should be automatically run on a well known set of pages.

Statically declared scripts are registered in the manifest under the "content_scripts" key. They can include JavaScript files, CSS files, or both. All auto-run content scripts must specify match patterns .

manifest.json

```
{ "name": "My extension", ... "content_scripts": [ { "matches": ["https://*.nytimes.com/*"], "css": ["my-styles.css"], "js": ["content-script.js"] } ], ... }
```

Name
Type
Description

matches
array of strings
Required. Specifies which pages this content script will be injected into. See Match Patterns for details on the syntax of these strings
and Match patterns and globs for information on how to exclude
URLs.

css
array of strings
Optional. The list of CSS files to be injected into matching pages. These are
injected in the order they appear in this array, before any DOM is constructed or displayed
for the page.

js

array of strings

Optional. The list of JavaScript files to be injected into matching pages. Files
are injected in the order they appear in this array. Each string in this list must contain
a relative path to a resource in the extension's root directory. Leading slashes (`/`) are
automatically trimmed.

run_at
RunAt
Optional. Specifies when the script should be injected into the page. Defaults to
document_idle .

match_about_blank
boolean
Optional. Whether the script should inject into an about:blank frame
where the parent or opener frame matches one of the patterns declared in
matches . Defaults to false.

match_origin_as_fallback
boolean

Optional. Whether the script should inject in frames that were
created by a matching origin, but whose URL or origin may not directly
match the pattern. These include frames with different schemes, such as
about: , data: , blob: , and
filesystem: . See also
Injecting in related frames .

world
ExecutionWorld

Optional. The JavaScript world for a script to execute within. Defaults to ISOLATED . See also
Work in isolated worlds .

Within a given stage of the document lifecycle, content scripts declared statically in the manifest are the first to be injected, before content scripts registered in any other way. They are injected in the order in which they are specified in the manifest.

### Inject with dynamic declarations

Dynamic content scripts are useful when the match patterns for content scripts are not well known or when content scripts shouldn't always be injected on known hosts.

Introduced in Chrome 96, dynamic declarations are similar to static declarations , but the content script object is registered with Chrome using methods in the chrome.scripting namespace rather than in manifest.json . The Scripting API also allows extension developers to:

- Register content scripts.

- Get a list of registered content scripts.

- Update the list of registered content scripts.

- Remove registered content scripts.

Like static declarations, dynamic declarations can include JavaScript files, CSS files, or both.

service-worker.js

```
chrome . scripting . registerContentScripts ([{ id : "session-script" , js : [ "content.js" ], persistAcrossSessions : false , matches : [ "*://example.com/*" ], runAt : "document_start" , }]) . then (() = > console . log ( "registration complete" )) . catch (( err ) = > console . warn ( "unexpected error" , err ))
```

service-worker.js

```
chrome . scripting . updateContentScripts ([{ id : "session-script" , excludeMatches : [ "*://admin.example.com/*" ], }]) . then (() = > console . log ( "registration updated" ));
```

service-worker.js

```
chrome . scripting . getRegisteredContentScripts () . then ( scripts = > console . log ( "registered content scripts" , scripts ));
```

service-worker.js

```
chrome . scripting . unregisterContentScripts ({ ids : [ "session-script" ] }) . then (() = > console . log ( "un-registration complete" ));
```

### Inject programmatically

Use programmatic injection for content scripts that need to run in response to events or on specific occasions.

To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as part of your extension's manifest or temporarily using "activeTab" .

The following are different versions of an activeTab-based extension.

manifest.json:

```
{ "name": "My extension", ... "permissions": [ "activeTab", "scripting" ], "background": { "service_worker": "background.js" }, "action": { "default_title": "Action Button" } }
```

Content scripts can be injected as files.

content-script.js

```
document . body . style . backgroundColor = "orange" ;
```

service-worker.js:

```
chrome . action . onClicked . addListener (( tab ) = > { chrome . scripting . executeScript ({ target : { tabId : tab . id }, files : [ "content-script.js" ] }); });
```

Or, a function body can be injected and executed as a content script.

service-worker.js:

```
function injectedFunction () { document . body . style . backgroundColor = "orange" ; } chrome . action . onClicked . addListener (( tab ) = > { chrome . scripting . executeScript ({ target : { tabId : tab . id }, func : injectedFunction , }); });
```

Be aware that the injected function is a copy of the function referenced in the chrome.scripting.executeScript() call, not the original function itself. As a result, the function's body must be self contained; references to variables outside of the function will cause the content script to throw a ReferenceError .

When injecting as a function, you can also pass arguments to the function.

service-worker.js

```
function injectedFunction ( color ) { document . body . style . backgroundColor = color ; } chrome . action . onClicked . addListener (( tab ) = > { chrome . scripting . executeScript ({ target : { tabId : tab . id }, func : injectedFunction , args : [ "orange" ], }); });
```

### Exclude matches and globs

To customize specified page matching, include the following fields in a declarative registration.

Name
Type
Description

exclude_matches
array of strings
Optional. Excludes pages that this content script would otherwise be injected
into. See Match Patterns for details of the syntax of
these strings.

include_globs
array of strings
Optional. Applied after matches to include only those URLs that also
match this glob. This is intended to emulate the @include
Greasemonkey keyword.

exclude_globs
array of string
Optional. Applied after matches to exclude URLs that match this
glob. Intended to emulate the @exclude
Greasemonkey keyword.

The content script will be injected into a page if both of the following are true:

- Its URL matches any matches pattern and any include_globs pattern.

- The URL doesn't also match an exclude_matches or exclude_globs pattern. Because the matches property is required, exclude_matches , include_globs , and exclude_globs can only be used to limit which pages will be affected.

The following extension injects the content script into https://www.nytimes.com/health but not into https://www.nytimes.com/business .

manifest.json

```
{ "name": "My extension", ... "content_scripts": [ { "matches": ["https://*.nytimes.com/*"], "exclude_matches": ["*://*/*business*"], "js": ["contentScript.js"] } ], ... }
```

service-worker.js

```
chrome . scripting . registerContentScripts ([{ id : "test" , matches : [ "https://*.nytimes.com/*" ], excludeMatches : [ "*://*/*business*" ], js : [ "contentScript.js" ], }]);
```

Glob properties follow a different, more flexible syntax than match patterns . Acceptable glob strings are URLs that may contain "wildcard" asterisks and question marks. The asterisk ( * ) matches any string of any length, including the empty string, while the question mark ( ? ) matches any single character.

For example, the glob https://???.example.com/foo/\* matches any of the following:

- https://www.example.com/foo/bar

- https://the.example.com/foo/

However, it does not match the following:

- https://my.example.com/foo/bar

- https://example.com/foo/

- https://www.example.com/foo

This extension injects the content script into https://www.nytimes.com/arts/index.html and https://www.nytimes.com/jobs/index.htm* , but not into https://www.nytimes.com/sports/index.html :

manifest.json

```
{ "name": "My extension", ... "content_scripts": [ { "matches": ["https://*.nytimes.com/*"], "include_globs": ["*nytimes.com/???s/*"], "js": ["contentScript.js"] } ], ... }
```

This extension injects the content script into https://history.nytimes.com and https://.nytimes.com/history , but not into https://science.nytimes.com or https://www.nytimes.com/science :

manifest.json

```
{ "name": "My extension", ... "content_scripts": [ { "matches": ["https://*.nytimes.com/*"], "exclude_globs": ["*science*"], "js": ["contentScript.js"] } ], ... }
```

One, all, or some of these can be included to achieve the correct scope.

manifest.json

```
{ "name": "My extension", ... "content_scripts": [ { "matches": ["https://*.nytimes.com/*"], "exclude_matches": ["*://*/*business*"], "include_globs": ["*nytimes.com/???s/*"], "exclude_globs": ["*science*"], "js": ["contentScript.js"] } ], ... }
```

### Run time

The run_at field controls when JavaScript files are injected into the web page. The preferred and default value is "document_idle" . See the RunAt type for other possible values.

manifest.json

```
{ "name": "My extension", ... "content_scripts": [ { "matches": ["https://*.nytimes.com/*"], "run_at": "document_idle", "js": ["contentScript.js"] } ], ... }
```

service-worker.js

```
chrome . scripting . registerContentScripts ([{ id : "test" , matches : [ "https://*.nytimes.com/*" ], runAt : "document_idle" , js : [ "contentScript.js" ], }]);
```

Name
Type
Description

document_idle
string
Preferred. Use "document_idle" whenever possible.

The browser
chooses a time to inject scripts between "document_end" and immediately after
the window.onload
event fires. The exact moment of injection depends on how complex the document is and how
long it is taking to load, and is optimized for page load speed.

Content scripts
running at "document_idle" don't need to listen for the
window.onload event, they are guaranteed to run after the DOM is complete. If a
script definitely needs to run after window.onload , the extension can check if
onload has already fired by using the document.readyState
property.

document_start
string
Scripts are injected after any files from css , but before any other DOM is
constructed or any other script is run.

document_end
string
Scripts are injected immediately after the DOM is complete, but before subresources like
images and frames have loaded.

### Specify frames

For declarative content scripts specified in the manifest, the "all_frames" field allows the extension to specify if JavaScript and CSS files should be injected into all frames matching the specified URL requirements or only into the topmost frame in a tab:

manifest.json

```
{ "name": "My extension", ... "content_scripts": [ { "matches": ["https://*.nytimes.com/*"], "all_frames": true, "js": ["contentScript.js"] } ], ... }
```

When programmatically registering content scripts using chrome.scripting.registerContentScripts(...) , the allFrames parameter can be used to specify if the content script should be injected into all frames matching the specified URL requirements or only into the topmost frame in a tab. This can only be used with tabId, and cannot be used if frameIds or documentIds are specified:

service-worker.js

```
chrome . scripting . registerContentScripts ([{ id: "test" , matches : [ "https://*.nytimes.com/*" ], allFrames : true , js : [ "contentScript.js" ], }]);
```

### Inject in to related frames

Extensions may want to run scripts in frames that are related to a matching frame, but don't themselves match. A common scenario when this is the case is for frames with URLs that were created by a matching frame, but whose URLs don't themselves match the script's specified patterns.

This is the case when an extension wants to inject in frames with URLs that have about: , data: , blob: , and filesystem: schemes. In these cases, the URL won't match the content script's pattern (and, in the case of about: and data: , don't even include the parent URL or origin in the URL at all, as in about:blank or data:text/html, Hello, World! ). However, these frames can still be associated with the creating frame.

To inject into these frames, extensions can specify the "match_origin_as_fallback" property on a content script specification in the manifest.

manifest.json

```
{ "name" : "My extension" , ... "content_scripts" : [ { "matches" : [ "https://*.google.com/*" ], "match_origin_as_fallback" : true , "js" : [ "contentScript.js" ] } ], ... }
```

When specified and set to true , Chrome will look at the origin of the initiator of the frame to determine whether the frame matches, rather than at the URL of the frame itself. Note that this might also be different than the target frame's origin (e.g., data: URLs have a null origin).

The initiator of the frame is the frame that created or navigated the target frame. While this is commonly the direct parent or opener, it may not be (as in the case of a frame navigating an iframe within an iframe).

Because this compares the origin of the initiator frame, the initiator frame could be on at any path from that origin. To make this implication clear, Chrome requires any content scripts specified with "match_origin_as_fallback" set to true to also specify a path of * .

When both "match_origin_as_fallback" and "match_about_blank" are specified, "match_origin_as_fallback" takes priority.

## Communication with the embedding page

Although the execution environments of content scripts and the pages that host them are isolated from each other, they share access to the page's DOM. If the page wishes to communicate with the content script, or with the extension through the content script, it must do so through the shared DOM.

An example can be accomplished using window.postMessage() :

content-script.js

```
var port = chrome . runtime . connect (); window . addEventListener ( "message" , ( event ) = > { // We only accept messages from ourselves if ( event . source !== window ) { return ; } if ( event . data . type && ( event . data . type === "FROM_PAGE" )) { console . log ( "Content script received: " + event . data . text ); port . postMessage ( event . data . text ); } }, false );
```

example.js

```
document . getElementById ( "theButton" ). addEventListener ( "click" , () = > { window . postMessage ( { type : "FROM_PAGE" , text : "Hello from the webpage!" }, "*" ); }, false );
```

The non-extension page, example.html, posts messages to itself. This message is intercepted and inspected by the content script and then posted to the extension process. In this way, the page establishes a line of communication to the extension process. The reverse is possible through similar means.

## Access extension files

To access an extension file from a content script, you can call chrome.runtime.getURL() to get the absolute URL of your extension asset as shown in the following example ( content.js ):

content-script.js

```
let image = chrome . runtime . getURL ( "images/my_image.png" )
```

To use fonts or images in a CSS file, you can use @@extension_id to construct a URL as shown in the following example ( content.css ):

content.css

```
body { background-image : url ( 'chrome-extension://__MSG_@@extension_id__/background.png' ); } @ font-face { font-family : 'Stint Ultra Expanded' ; font-style : normal ; font-weight : 400 ; src : url ( 'chrome-extension://__MSG_@@extension_id__/fonts/Stint Ultra Expanded.woff' ) format ( 'woff' ); }
```

All assets must be declared as web accessible resources in the manifest.json file:

manifest.json

```
{ ... "web_accessible_resources" : [ { "resources" : [ "images/*.png" ], "matches" : [ "https://example.com/*" ] }, { "resources" : [ "fonts/*.woff" ], "matches" : [ "https://example.com/*" ] } ], ... }
```

## Content Security Policy

Content scripts running in isolated worlds have the following Content Security Policy (CSP):

```
script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' chrome-extension://abcdefghijklmopqrstuvwxyz/; object-src 'self';
```

Similar to the restrictions applied to other extension contexts, this prevents the use of eval() as well as loading external scripts.

For unpacked extensions, the CSP also includes localhost:

```
script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:* chrome-extension://abcdefghijklmopqrstuvwxyz/; object-src 'self';
```

When a content script is injected into the main world, the CSP of the page applies.

## Stay secure

While isolated worlds provide a layer of protection, using content scripts can create vulnerabilities in an extension and the web page. If the content script receives content from a separate website, such as by calling fetch() , be careful to filter content against cross-site scripting attacks before injecting it. Only communicate over HTTPS in order to avoid "man-in-the-middle" attacks.

Be sure to filter for malicious web pages. For example, the following patterns are dangerous, and disallowed in Manifest V3:

Don't

content-script.js

```
const data = document . getElementById ( "json-data" ); // WARNING! Might be evaluating an evil script! const parsed = eval ( "(" + data + ")" );
```

Don't

content-script.js

```
const elmt_id = ... // WARNING! elmt_id might be '); ... evil script ... //'! window . setTimeout ( "animate(" + elmt_id + ")" , 200 );
```

Instead, prefer safer APIs that don't run scripts:

Do

content-script.js

```
const data = document . getElementById ( "json-data" ) // JSON.parse does not evaluate the attacker's scripts. const parsed = JSON . parse ( data );
```

Do

content-script.js

```
const elmt_id = ... // The closure form of setTimeout does not evaluate scripts. window . setTimeout (() => animate ( elmt_id ), 200 );
```

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License , and code samples are licensed under the Apache 2.0 License . For details, see the Google Developers Site Policies . Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2012-09-17 UTC.

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],["Last updated 2012-09-17 UTC."],[],[]]
