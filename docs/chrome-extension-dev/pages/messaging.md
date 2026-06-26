# Message passing

Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
Downloaded: 2026-06-26T05:25:33.621Z

Messaging APIs allow you to communicate between different scripts running in contexts associated with your extension. This includes communication between your service worker, chrome-extension://pages and content scripts. For example, an RSS reader extension might use content scripts to detect the presence of an RSS feed on a page, then notify the service worker to update the action icon for that page.

There are two message passing APIs: one for one-time requests , and a more complex one for long-lived connections that allow multiple messages to be sent.

For information about sending messages between extensions, see the cross-extension messages section.

## One-time requests

To send a single message to another part of your extension, and optionally get a response, call runtime.sendMessage() or tabs.sendMessage() . These methods let you send a one-time JSON-serializable message from a content script to the extension, or from the extension to a content script. Both APIs return a Promise which resolves to the response provided by a recipient.

Sending a request from a content script looks like this:

content-script.js:

```
( async () = > { const response = await chrome . runtime . sendMessage ({ greeting : "hello" }); // do something with response here, not outside the function console . log ( response ); })();
```

### Responses

To listen for a message, use the chrome.runtime.onMessage event:

```
// Event listener function handleMessages ( message , sender , sendResponse ) { if ( message !== 'get-status' ) return ; fetch ( 'https://example.com' ) . then (( response ) = > sendResponse ({ statusCode : response . status })) // Since `fetch` is asynchronous, must return an explicit `true` return true ; } chrome . runtime . onMessage . addListener ( handleMessages ); // From the sender's context... const { statusCode } = await chrome . runtime . sendMessage ( 'get-status' );
```

When the event listener is called, a sendResponse function is passed as the third parameter. This is a function that can be called to provide a response. By default, the sendResponse callback must be called synchronously.

If you call sendResponse without any parameters, null is sent as a response.

To send a response asynchronously, you have two options: returning true or returning a promise.

Return true

To respond asynchronously using sendResponse() , return a literal true (not just a truthy value) from the event listener. Doing so will keep the message channel open to the other end until sendResponse is called, allowing you to call it later.

Return a promise

From Chrome 148, you can return a promise from a message listener to respond asynchronously. This update is rolling out gradually, so you may find that it's not yet available in all users' browsers. You should make sure your extension can handle whether this capability is enabled or not. Using return true; will continue to work for asynchronous responses whether this capability is enabled or not.

Note: Promise support is not enabled in extension script contexts if
the extension extends DevTools with a
devtools page
even if the capability is enabled.

If the promise resolves, its resolved value is sent as the response.

If the promise is rejected, the sender's sendMessage() call will be rejected with the error's message. See the error handling section for more details and examples.

An example that shows returning a promise that could resolve or reject:

```
// Event listener function handleMessages ( message , sender , sendResponse ) { // Return a promise that wraps fetch // If the response is OK, resolve with the status. If it's not OK then reject // with the network error that prevents the fetch from completing. return new Promise (( resolve , reject ) = > { fetch ( 'https://example.com' ) . then ( response = > { if ( ! response . ok ) { reject ( response ); } else { resolve ( response . status ); } }) . catch ( error = > { reject ( error ); }); }); } chrome . runtime . onMessage . addListener ( handleMessages );
```

You can also declare a listener as async to return a promise:

```
chrome . runtime . onMessage . addListener ( async function ( message , sender ) { const response = await fetch ( 'https://example.com' ); if ( ! response . ok ) { // rejects the promise returned by `async function`. throw new Error ( `Fetch failed: ${ response . status } ` ); } // resolves the promise returned by `async function`. return { statusCode : response . status }; });
```

Return a promise: async function gotchas

Keep in mind that an async function as a listener will always return a promise, even without a return statement. If an async listener does not return a value its promise implicitly resolves to undefined , and null is sent as the response to the sender. This can cause unexpected behavior when there are multiple listeners:

```
// content_script.js function handleResponse ( message ) { // The first listener promise resolves to `undefined` before the second // listener can respond. When a listener responds with `undefined`, Chrome // sends null as the response. console . assert ( message === null ); } function notifyBackgroundPage () { const sending = chrome . runtime . sendMessage ( 'test' ); sending . then ( handleResponse ); } notifyBackgroundPage (); // background.js chrome . runtime . onMessage . addListener ( async ( message ) = > { // This just causes the function to pause for a millisecond, but the promise // is *not* returned from the listener so it doesn't act as a response. await new Promise ( resolve = > { setTimeout ( resolve , 1 , 'OK' ); }); // `async` functions always return promises. So once we // reach here there is an implicit `return undefined;`. Chrome translates // `undefined` responses to `null`. }); chrome . runtime . onMessage . addListener (( message , sender , sendResponse ) = > { return new Promise (( resolve ) = > { setTimeout ( resolve , 1000 , 'response' ); }); });
```

### Error handling

From Chrome 146, if an onMessage listener throws an error (either synchronously, or asynchronously by returning a promise that rejects), the promise returned by sendMessage() in the sender will reject with the error's message. This update is rolling out gradually, so you may find this change is not yet effective in all users' browsers. You should make sure your extension can handle whether this change is enabled or not.

Note: This behavior is not enabled in extension script contexts if the extension
extends DevTools with a
devtools page
even if the change is enabled.

If a listener tries to return a response that cannot be serialized (without catching the resulting TypeError ) this will also be considered the listener throwing an error.

If a listener returns a promise that rejects, it must reject with an Error instance for the sender to receive that error message. If the promise is rejected with any other value (such as null or undefined ), sendMessage() will be rejected with a generic error message instead.

If multiple listeners are registered for onMessage , only the first listener to respond, reject, or throw an error will affect the sender; all other listeners will run, but their results will be ignored.

Examples

If a listener returns a promise that rejects, sendMessage() is rejected:

```
// sender.js try { await chrome . runtime . sendMessage ( 'test' ); } catch ( e ) { console . log ( e . message ); // "some error" } // listener.js chrome . runtime . onMessage . addListener (( message , sender , sendResponse ) = > { return Promise . reject ( new Error ( 'some error' )); });
```

If a listener responds with a value that cannot be serialized, sendMessage() is rejected:

```
// sender.js try { await chrome . runtime . sendMessage ( 'test' ); } catch ( e ) { console . log ( e . message ); // "Error: Could not serialize message." } // listener.js chrome . runtime . onMessage . addListener (( message , sender , sendResponse ) = > { sendResponse (() = > {}); // Functions are not serializable return true ; // Keep channel open for async sendResponse });
```

If a listener throws an error synchronously before any other listener responds, the listener's sendMessage() promise is rejected:

```
// sender.js try { await chrome . runtime . sendMessage ( 'test' ); } catch ( e ) { console . log ( e . message ); // "error!" } // listener.js chrome . runtime . onMessage . addListener (( message , sender , sendResponse ) = > { throw new Error ( 'error!' ); });
```

However, if one listener responds before another one throws an error, sendMessage() succeeds:

```
// sender.js const response = await chrome . runtime . sendMessage ( 'test' ); console . log ( response ); // "OK" // listener.js chrome . runtime . onMessage . addListener (( message , sender , sendResponse ) = > { sendResponse ( 'OK' ); }); chrome . runtime . onMessage . addListener (( message , sender , sendResponse ) = > { throw new Error ( 'error!' ); });
```

## Long-lived connections

To create a reusable long-lived message passing channel, call:

- runtime.connect() to pass messages from a content script to an extension page

- tabs.connect() to pass messages from an extension page to a content script.

You can name your channel by passing an options parameter with a name key to distinguish between different types of connections:

```
const port = chrome . runtime . connect ({ name : "example" });
```

One potential use case for a long-lived connection is an automatic form-filling extension. The content script might open a channel to the extension page for a specific login, and send a message to the extension for each input element on the page to request the form data to fill in. The shared connection allows the extension to share state between extension components.

When establishing a connection, each end is assigned a runtime.Port object for sending and receiving messages through that connection.

Use the following code to open a channel from a content script, and send and listen for messages:

content-script.js:

```
const port = chrome . runtime . connect ({ name : "knockknock" }); port . onMessage . addListener ( function ( msg ) { if ( msg . question === "Who's there?" ) { port . postMessage ({ answer : "Madame" }); } else if ( msg . question === "Madame who?" ) { port . postMessage ({ answer : "Madame... Bovary" }); } }); port . postMessage ({ joke : "Knock knock" });
```

To send a request from the extension to a content script, replace the call to runtime.connect() in the previous example with tabs.connect() .

To handle incoming connections for either a content script or an extension page, set up a runtime.onConnect event listener. When another part of your extension calls connect() , it activates this event and the runtime.Port object. The code for responding to incoming connections looks like this:

service-worker.js:

```
chrome . runtime . onConnect . addListener ( function ( port ) { if ( port . name !== "knockknock" ) { return ; } port . onMessage . addListener ( function ( msg ) { if ( msg . joke === "Knock knock" ) { port . postMessage ({ question : "Who's there?" }); } else if ( msg . answer === "Madame" ) { port . postMessage ({ question : "Madame who?" }); } else if ( msg . answer === "Madame... Bovary" ) { port . postMessage ({ question : "I don't get it." }); } }); });
```

## Serialization

In Chrome, the message passing APIs use JSON serialization . Notably, this is different to other browsers which implement the same APIs with the structured clone algorithm.

This means a message (and responses provided by recipients) can contain any valid JSON.stringify() value. Other values will be coerced into serializable values (notably undefined will be serialized as null );

## Message size limits

The maximum size of a message is 64 MiB.

## Port lifetime

Ports are designed as a two-way communication mechanism between different parts of an extension. When part of an extension calls tabs.connect() , runtime.connect() or runtime.connectNative() , it creates a Port that can immediately send messages using postMessage() .

If there are multiple frames in a tab, calling tabs.connect() invokes the runtime.onConnect event once for each frame in the tab. Similarly, if runtime.connect() is called, then the onConnect event can fire once for every frame in the extension process.

You might want to find out when a connection is closed, for example if you're maintaining separate states for each open port. To do this, listen to the runtime.Port.onDisconnect event. This event fires when there are no valid ports at the other end of the channel, which can have any of the following causes:

- There are no listeners for runtime.onConnect at the other end.

- The tab containing the port is unloaded (for example, if the tab is navigated).

- The frame where connect() was called has unloaded.

- All frames that received the port (via runtime.onConnect ) have unloaded.

- runtime.Port.disconnect() is called by the other end . If a connect() call results in multiple ports at the receiver's end, and disconnect() is called on any of these ports, then the onDisconnect event only fires at the sending port, not at the other ports.

Warning: Be aware that a Port can have multiple receivers connected at any given
time. As a result, onDisconnect may fire more than once and you may not want
to stop sending messages on a Port just because there has been a single
disconnection.

## Cross-extension messaging

In addition to sending messages between different components in your extension, you can use the messaging API to communicate with other extensions. This lets you expose a public API for other extensions to use.

To listen for incoming requests and connections from other extensions, use the runtime.onMessageExternal or runtime.onConnectExternal methods. Here's an example of each:

service-worker.js

```
// For a single request: chrome . runtime . onMessageExternal . addListener ( function ( request , sender , sendResponse ) { if ( sender . id !== allowlistedExtension ) { return ; // don't allow this extension access } if ( request . getTargetData ) { sendResponse ({ targetData : targetData }); } else if ( request . activateLasers ) { const success = activateLasers (); sendResponse ({ activateLasers : success }); } } ); // For long-lived connections: chrome . runtime . onConnectExternal . addListener ( function ( port ) { port . onMessage . addListener ( function ( msg ) { // See other examples for sample onMessage handlers. }); });
```

To send a message to another extension, pass the ID of the extension you want to communicate with as follows:

service-worker.js

```
// The ID of the extension we want to talk to. const laserExtensionId = "abcdefghijklmnoabcdefhijklmnoabc" ; // For a minimal request: chrome . runtime . sendMessage ( laserExtensionId , { getTargetData : true }, function ( response ) { if ( targetInRange ( response . targetData )) chrome . runtime . sendMessage ( laserExtensionId , { activateLasers : true }); } ); // For a long-lived connection: const port = chrome . runtime . connect ( laserExtensionId ); port . postMessage (...);
```

## Send messages from web pages

Extensions can also receive and respond to messages from web pages. To send messages from a web page to an extension, specify in your manifest.json which websites you want to allow messages from using the "externally_connectable" manifest key. For example:

manifest.json

```
"externally_connectable" : { "matches" : [ "https://*.example.com/*" ] }
```

This exposes the messaging API to any page that matches the match patterns you specify.

Use the runtime.sendMessage() or runtime.connect() APIs to send a message to a specific extension. For example:

webpage.js

```
// The ID of the extension we want to talk to. const editorExtensionId = 'abcdefghijklmnoabcdefhijklmnoabc' ; // Check if extension is installed if ( chrome && chrome . runtime ) { // Make a request: chrome . runtime . sendMessage ( editorExtensionId , { openUrlInEditor : url }, ( response ) = > { if ( ! response . success ) handleError ( url ); } ); }
```

From your extension, listen to messages from web pages using the runtime.onMessageExternal or runtime.onConnectExternal APIs as in cross-extension messaging . Here's an example:

service-worker.js

```
chrome . runtime . onMessageExternal . addListener ( function ( request , sender , sendResponse ) { if ( sender . url === blocklistedWebsite ) return ; // don't allow this web page access if ( request . openUrlInEditor ) openUrl ( request . openUrlInEditor ); });
```

It is not possible to send a message from an extension to a web page.

## Native messaging

Extensions can exchange messages with native applications that are registered as a native messaging host . To learn more about this feature, see Native messaging .

## Security considerations

Here are a few security considerations related to messaging.

### Content scripts are less trustworthy

Content scripts are less trustworthy than the extension service worker. For example, a malicious web page might be able to compromise the rendering process that runs the content scripts. Assume that messages from a content script might have been crafted by an attacker and make sure to validate and sanitize all input . Assume any data sent to the content script might leak to the web page. Limit the scope of privileged actions that can be triggered by messages received from content scripts.

### Cross-site scripting

Make sure to protect your scripts against cross-site scripting . When receiving data from an untrusted source such as user input, other websites through a content script, or an API, take care to avoid interpreting this as HTML or using it in a way which could allow unexpected code to run.

Safer methods

Use APIs that don't run scripts whenever possible:

service-worker.js

```
chrome . tabs . sendMessage ( tab . id , { greeting : "hello" }, function ( response ) { // JSON.parse doesn't evaluate the attacker's scripts. const resp = JSON . parse ( response . farewell ); });
```

service-worker.js

```
chrome . tabs . sendMessage ( tab . id , { greeting : "hello" }, function ( response ) { // innerText does not let the attacker inject HTML elements. document . getElementById ( "resp" ). innerText = response . farewell ; });
```

Unsafe methods

Avoid using the following methods that make your extension vulnerable:

service-worker.js

```
chrome . tabs . sendMessage ( tab . id , { greeting : "hello" }, function ( response ) { // WARNING! Might be evaluating a malicious script! const resp = eval ( `( ${ response . farewell } )` ); });
```

service-worker.js

```
chrome . tabs . sendMessage ( tab . id , { greeting : "hello" }, function ( response ) { // WARNING! Might be injecting a malicious script! document . getElementById ( "resp" ). innerHTML = response . farewell ; });
```

Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License , and code samples are licensed under the Apache 2.0 License . For details, see the Google Developers Site Policies . Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2025-12-03 UTC.

[[["Easy to understand","easyToUnderstand","thumb-up"],["Solved my problem","solvedMyProblem","thumb-up"],["Other","otherUp","thumb-up"]],[["Missing the information I need","missingTheInformationINeed","thumb-down"],["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"],["Out of date","outOfDate","thumb-down"],["Samples / code issue","samplesCodeIssue","thumb-down"],["Other","otherDown","thumb-down"]],["Last updated 2025-12-03 UTC."],[],[]]
