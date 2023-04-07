const cam = document.querySelector('#cam');
const startRecordingButton = document.querySelector('#start-recording');
const endRecordingButton = document.querySelector('#end-recording');
const recordingStatus = document.querySelector('#recording-status');

/** RECORDING & MUXING STUFF */

let muxer = null;
let videoEncoder = null;
let audioEncoder = null;
let startTime = null;
let recording = false;
let videoTrack = null;
let audioTrack = null;
let intervalId = null;
let lastKeyFrame = null;

let buffer = [];

const startRecording = async () => {
	// Check for VideoEncoder availability
	startRecordingButton.style.display = 'none';

	// Check for AudioEncoder availability
	if (typeof AudioEncoder !== 'undefined' && typeof VideoEncoder !== 'undefined') {
		// Try to get access to the user's microphone
		try {
			let stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
			videoTrack = stream.getVideoTracks()[0];
			audioTrack = stream.getAudioTracks()[0];
      console.log(videoTrack, audioTrack);
      cam.srcObject = stream;
      cam.play();
		} catch (e) {}
		if (!videoTrack) console.warn("Couldn't acquire a user media video track.");
		if (!audioTrack) console.warn("Couldn't acquire a user media audio track.");
	} else {
		alert("AudioEncoder or VideoEncoder not available");
	}

	endRecordingButton.style.display = 'block';

	let audioSampleRate = audioTrack?.getCapabilities().sampleRate.max;

	// Create a WebM muxer with a video track and maybe an audio track
	muxer = new WebMMuxer({
		// target: 'buffer',
    target: (data, offset, done) => {
      buffer.push(data);
      if (done) {
	      downloadBlob(new Blob(buffer));
      }
    },
		video: {
			codec: 'V_VP9',
			width: cam.width,
			height: cam.height,
			frameRate: 30
		},
		audio: audioTrack ? {
			codec: 'A_OPUS',
			sampleRate: audioSampleRate,
			numberOfChannels: 1
		} : undefined,
		firstTimestampBehavior: 'offset' // Because we're directly pumping a MediaStreamTrack's data into it
	});

	if (videoTrack) {
		videoEncoder = new VideoEncoder({
			output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
			error: e => console.error(e)
		});
		videoEncoder.configure({
      hardwareAcceleration: "prefer-software",
      codec: 'vp09.00.10.08',
      width: cam.width,
      height: cam.height,
      bitrate: 2_500_000,
      framerate: 30,
      latencyMode: "realtime",
		});

		// Create a MediaStreamTrackProcessor to get AudioData chunks from the audio track
		let trackProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
		let consumer = new WritableStream({
			write(videoData) {
				if (!recording) return;
				videoEncoder.encode(videoData);
				videoData.close();
			}
		});
		trackProcessor.readable.pipeTo(consumer);
	}

	if (audioTrack) {
		audioEncoder = new AudioEncoder({
			output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
			error: e => console.error(e)
		});
		audioEncoder.configure({
			codec: 'opus',
			numberOfChannels: 1,
			sampleRate: audioSampleRate,
			bitrate: 128_000,
		});

		// Create a MediaStreamTrackProcessor to get AudioData chunks from the audio track
		let trackProcessor = new MediaStreamTrackProcessor({ track: audioTrack });
		let consumer = new WritableStream({
			write(audioData) {
				if (!recording) return;
				audioEncoder.encode(audioData);
				audioData.close();
			}
		});
		trackProcessor.readable.pipeTo(consumer);
	}

	startTime = document.timeline.currentTime;
	recording = true;
	lastKeyFrame = -Infinity;

	intervalId = setInterval(timer, 1000/30);
};
startRecordingButton.addEventListener('click', startRecording);

const timer = () => {
	let elapsedTime = document.timeline.currentTime - startTime;

	recordingStatus.textContent =
		`${elapsedTime % 1000 < 500 ? '🔴' : '⚫'} Recording - ${(elapsedTime / 1000).toFixed(1)} s`;
};

const endRecording = async () => {
	endRecordingButton.style.display = 'none';
	recordingStatus.textContent = '';
	recording = false;

	clearInterval(intervalId);
	audioTrack?.stop();

	await videoEncoder.flush();
	await audioEncoder.flush();
	let _buffer = muxer.finalize();


	videoEncoder = null;
	audioEncoder = null;
	muxer = null;
	startTime = null;
	firstAudioTimestamp = null;

	startRecordingButton.style.display = 'block';
};
endRecordingButton.addEventListener('click', endRecording);

const downloadBlob = (blob) => {
	let url = window.URL.createObjectURL(blob);
	let a = document.createElement('a');
	a.style.display = 'none';
	a.href = url;
	a.download = 'cam.webm';
	document.body.appendChild(a);
	a.click();
	window.URL.revokeObjectURL(url);
};
