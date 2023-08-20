# webm-muxer - JavaScript WebM multiplexer

[![](https://img.shields.io/npm/v/webm-muxer)](https://www.npmjs.com/package/webm-muxer)
[![](https://img.shields.io/bundlephobia/minzip/webm-muxer)](https://bundlephobia.com/package/webm-muxer)

The WebCodecs API provides low-level access to media codecs, but provides no way of actually packaging (multiplexing)
the encoded media into a playable file. This project implements a WebM/Matroska multiplexer in pure TypeScript, which is
high-quality, fast and tiny, and supports both video and audio as well as live-streaming.

[Demo: Muxing into a file](https://vanilagy.github.io/webm-muxer/demo/)

[Demo: Streaming](https://vanilagy.github.io/webm-muxer/demo-streaming/)

> **Note:** If you're looking to create **MP4** files, check out [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), the
sister library to webm-muxer.

## Quick start
The following is an example for a common usage of this library:
```js
import { Muxer, ArrayBufferTarget } from 'webm-muxer';

let muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
        codec: 'V_VP9',
        width: 1280,
        height: 720
    }
});

let videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => console.error(e)
});
videoEncoder.configure({
    codec: 'vp09.00.10.08',
    width: 1280,
    height: 720,
    bitrate: 1e6
});

/* Encode some frames... */

await videoEncoder.flush();
muxer.finalize();

let { buffer } = muxer.target; // Buffer contains final WebM file
```

## Motivation
This library was created to power the in-game video renderer of the browser game
[Marble Blast Web](https://github.com/vanilagy/marbleblast) - [here](https://www.youtube.com/watch?v=ByCcAIoXsKY) you
can find a video completely rendered by it and muxed with this library. Previous efforts at in-browser WebM muxing,
such as [webm-writer-js](https://github.com/thenickdude/webm-writer-js) or
[webm-muxer.js](https://github.com/davedoesdev/webm-muxer.js), were either lacking in functionality or were way too
heavy in terms of byte size, which prompted the creation of this library.

## Installation
Using NPM, simply install this package using
```
npm install webm-muxer
```
You can import all exported classes like so:
```js
import * as WebMMuxer from 'webm-muxer';
// Or, using CommonJS:
const WebMMuxer = require('webm-muxer');
```
Alternatively, you can simply include the library as a script in your HTML, which will add a `WebMMuxer` object,
containing all the exported classes, to the global object, like so:
```html
<script src="build/webm-muxer.js"></script>
```

## Usage
### Initialization
For each WebM file you wish to create, create an instance of `Muxer` like so:
```js
import { Muxer } from 'webm-muxer';

let muxer = new Muxer(options);
```
The available options are defined by the following interface:
```ts
interface MuxerOptions {
    target:
        | ArrayBufferTarget
        | StreamTarget
        | FileSystemWritableFileStreamTarget,

    video?: {
        codec: string,
        width: number,
        height: number,
        frameRate?: number, // Optional, adds metadata to the file
        alpha?: boolean // If the video contains transparency data
    },

    audio?: {
        codec: string,
        numberOfChannels: number,
        sampleRate: number,
        bitDepth?: number // Mainly necessary for PCM-coded audio
    },

    streaming?: boolean,

    type?: 'webm' | 'matroska',

    firstTimestampBehavior?: 'strict' | 'offset' | 'permissive'
}
```
Codecs officially supported by WebM are `V_VP8`, `V_VP9`, `V_AV1`, `A_OPUS` and `A_VORBIS`.
#### `target`
This option specifies where the data created by the muxer will be written. The options are:
- `ArrayBufferTarget`: The file data will be written into a single large buffer, which is then stored in the target.

    ```js
    import { Muxer, ArrayBufferTarget } from 'webm-muxer';

    let muxer = new Muxer({
        target: new ArrayBufferTarget(),
        // ...
    });

    // ...

    muxer.finalize();
    let { buffer } = muxer.target;
    ```
- `StreamTarget`: This target defines callbacks that will get called whenever there is new data available  - this is
    useful if you want to stream the data, e.g. pipe it somewhere else. The constructor has the following signature:

    ```ts
    constructor(
        onData: (data: Uint8Array, position: number) => void,
        onDone?: () => void,
        options?: { chunked?: true, chunkSize?: number }
    );
    ```

    The `position` argument specifies the offset in bytes at which the data has to be written. Since the data written by
    the muxer is not entirely sequential, **make sure to respect this argument**.
    
    When using `chunked: true` in the options, data created by the muxer will first be accumulated and only written out
    once it has reached sufficient size. This is useful for reducing the total amount of writes, at the cost of
    latency. It using a default chunk size of 16 MiB, which can be overridden by manually setting `chunkSize` to the
    desired byte length.
    
    If you want to use this target for *live-streaming*, make sure to also set `streaming: true` in the muxer options.
    This will ensure that data is written monotonically (sequentially) and already-written data is never "patched" -
    necessary for live-streaming, but not recommended for muxing files for later viewing.

    ```js
    import { Muxer, StreamTarget } from 'webm-muxer';

    let muxer = new Muxer({
        target: new StreamTarget(
            (data, position) => { /* Do something with the data */ },
            () => { /* Muxing has finished */ }
        ),
        // ...
    });
    ```
- `FileSystemWritableFileStreamTarget`: This is essentially a wrapper around a chunked `StreamTarget` with the intention
    of simplifying the use of this library with the File System Access API. Writing the file directly to disk as it's
    being created comes with many benefits, such as creating files way larger than the available RAM.

    You can optionally override the default `chunkSize` of 16 MiB.
    ```ts
    constructor(
        stream: FileSystemWritableFileStream,
        options?: { chunkSize?: number }
    );
    ```

    Usage example:
    ```js
    import { Muxer, FileSystemWritableFileStreamTarget } from 'webm-muxer';
    
    let fileHandle = await window.showSaveFilePicker({
        suggestedName: `video.webm`,
        types: [{
            description: 'Video File',
            accept: { 'video/webm': ['.webm'] }
        }],
    });
    let fileStream = await fileHandle.createWritable();
    let muxer = new Muxer({
        target: new FileSystemWritableFileStreamTarget(fileStream),
        // ...
    });
    
    // ...

    muxer.finalize();
    await fileStream.close(); // Make sure to close the stream
    ```
#### `streaming` (optional)
Configures the muxer to only write data monotonically, useful for live-streaming the WebM as it's being muxed; intended
to be used together with the `target` set to type `function`. When enabled, some features such as storing duration and
seeking will be disabled or impacted, so don't use this option when you want to write out WebM file for later use.
#### `type` (optional)
As WebM is a subset of the more general Matroska multimedia container format, this library muxes both WebM and Matroska
files. WebM, according to the official specification, supports only a small subset of the codecs supported by Matroska.
It is likely, however, that most players will successfully play back a WebM file with codecs other than the ones
supported in the spec. To be on the safe side, however, you can set the `type` option to `'matroska'`, which
will internally label the file as a general Matroska file. If you do this, your output file should also have the .mkv
extension.
#### `firstTimestampBehavior` (optional)
Specifies how to deal with the first chunk in each track having a non-zero timestamp. In the default strict mode,
timestamps must start with 0 to ensure proper playback. However, when directly pumping video frames or audio data
from a MediaTrackStream into the encoder and then the muxer, the timestamps are usually relative to the age of
the document or the computer's clock, which is typically not what we want. Handling of these timestamps must be
set explicitly:
- Use `'offset'` to offset the timestamp of each video track by that track's first chunk's timestamp. This way, it
starts at 0.
- Use `'permissive'` to allow the first timestamp to be non-zero.

### Muxing media chunks
Then, with VideoEncoder and AudioEncoder set up, send encoded chunks to the muxer using the following methods:
```ts
addVideoChunk(
    chunk: EncodedVideoChunk,
    meta?: EncodedVideoChunkMetadata,
    timestamp?: number
): void;

addAudioChunk(
    chunk: EncodedAudioChunk,
    meta?: EncodedAudioChunkMetadata,
    timestamp?: number
): void;
```

Both methods accept an optional, third argument `timestamp` (microseconds) which, if specified, overrides
the `timestamp` property of the passed-in chunk.

The metadata comes from the second parameter of the `output` callback given to the
VideoEncoder or AudioEncoder's constructor and needs to be passed into the muxer, like so:
```js
let videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => console.error(e)
});
videoEncoder.configure(/* ... */);
```

Should you have obtained your encoded media data from a source other than the WebCodecs API, you can use these following
methods to directly send your raw data to the muxer:
```ts
addVideoChunkRaw(
    data: Uint8Array,
    type: 'key' | 'delta',
    timestamp: number, // In microseconds
    meta?: EncodedVideoChunkMetadata
): void;

addAudioChunkRaw(
    data: Uint8Array,
    type: 'key' | 'delta',
    timestamp: number, // In microseconds
    meta?: EncodedAudioChunkMetadata
): void;
```

### Finishing up
When encoding is finished and all the encoders have been flushed, call `finalize` on the `Muxer` instance to finalize
the WebM file:
```js
muxer.finalize();
```
When using an ArrayBufferTarget, the final buffer will be accessible through it:
```js
let { buffer } = muxer.target;
```
When using a FileSystemWritableFileStreamTarget, make sure to close the stream after calling `finalize`:
```js
await fileStream.close();
```

## Details
### Video key frame frequency
Canonical WebM files can only have a maximum Matroska Cluster length of 32.768 seconds, and each cluster must begin with
a video key frame. You therefore need to tell your `VideoEncoder` to encode a `VideoFrame` as a key frame at least every
32 seconds, otherwise your WebM file will be incorrect. You can do this by doing:
```js
videoEncoder.encode(frame, { keyFrame: true });
```

### Media chunk buffering
When muxing a file with a video **and** an audio track, it is important that the individual chunks inside the WebM file
be stored in monotonically increasing time. This does mean, however, that the multiplexer must buffer chunks of one
medium if the other medium has not yet encoded chunks up to that timestamp. For example, should you first encode all
your video frames and then encode the audio afterwards, the multiplexer will have to hold all those video frames in
memory until the audio chunks start coming in. This might lead to memory exhaustion should your video be very long.
When there is only one media track, this issue does not arise. So, when muxing a multimedia file, make sure it is
somewhat limited in size or the chunks are encoded in a somewhat interleaved way (like is the case for live media).

### Size "limits"
This library can mux WebM files up to a total size of ~4398 GB and with a Matroska Cluster size of ~34 GB.

## Implementation & development
WebM files are a subset of the more general Matroska media container format. Matroska in turn uses a format known as
EBML (think of it like binary XML) to structure its file. This project therefore implements a simple EBML writer to
create the Matroska elements needed to form a WebM file. Many thanks to
[webm-writer-js](https://github.com/thenickdude/webm-writer-js) for being the inspiration for most of the core EBML
writing code.

For development, clone this repository, install everything with `npm install`, then run `npm run watch` to bundle the
code into the `build` directory. Run `npm run check` to run the TypeScript type checker, and `npm run lint` to run
ESLint.