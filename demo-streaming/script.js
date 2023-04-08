const camPreview = document.querySelector('#cam-preview');
const startRecordingButton = document.querySelector('#start-recording');
const endRecordingButton = document.querySelector('#end-recording');
const recordingStatus = document.querySelector('#recording-status');

/** RECORDING & MUXING STUFF */

let muxer = null;
let videoEncoder = null;
let audioEncoder = null;
let startTime = null;
let recording = false;
let audioTrack = null;
let videoTrack = null;
let intervalId = null;
let lastKeyFrame = null;
let buffers = [];

const startRecording = async () => {
	// Check for AudioEncoder availability
	if (typeof AudioEncoder === 'undefined') {
		alert("Looks like your user agent doesn't support AudioEncoder / WebCodecs API yet.");
		return;
	}
	// Check for VideoEncoder availability
	if (typeof VideoEncoder === 'undefined') {
		alert("Looks like your user agent doesn't support VideoEncoder / WebCodecs API yet.");
		return;
	}

	startRecordingButton.style.display = 'none';

	// Try to get access to the user's camera and microphone
	try {
		let userMedia = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
		audioTrack = userMedia.getAudioTracks()[0];
		videoTrack = userMedia.getVideoTracks()[0];
		camPreview.srcObject = userMedia;
		camPreview.play();
	} catch (e) {}
	if (!audioTrack) console.warn("Couldn't acquire a user media audio track.");
	if (!videoTrack) console.warn("Couldn't acquire a user media video track.");

	endRecordingButton.style.display = 'block';

	let audioSampleRate = audioTrack?.getCapabilities().sampleRate.max;
	let videoTrackWidth = videoTrack?.getSettings().width;
	let videoTrackHeight = videoTrack?.getSettings().height;

	// Create a WebM muxer with a video track and maybe an audio track
	muxer = new WebMMuxer({
		streaming: true,
		target: (buffer, offset, done) => {
			buffers.push(buffer);

			if (done) {
				downloadBlob(new Blob(buffers));
			}
		},
		video: {
			codec: 'V_VP9',
			width: videoTrackWidth,
			height: videoTrackHeight,
			frameRate: 30
		},
		audio: audioTrack ? {
			codec: 'A_OPUS',
			sampleRate: audioSampleRate,
			numberOfChannels: 1
		} : undefined,
		firstTimestampBehavior: 'offset' // Because we're directly pumping a MediaStreamTrack's data into it
	});

	// Audio track
	audioEncoder = new AudioEncoder({
		output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
		error: e => console.error(e)
	});
	audioEncoder.configure({
		codec: 'opus',
		numberOfChannels: 1,
		sampleRate: audioSampleRate,
		bitrate: 64000,
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

	// Video track
	videoEncoder = new VideoEncoder({
		output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
		error: e => console.error(e)
	});
	videoEncoder.configure({
		codec: 'vp09.00.10.08',
		width: videoTrackWidth,
		height: videoTrackHeight,
		bitrate: 1e6
	});

	// Create a MediaStreamTrackProcessor to get VideoData chunks from the video track
	let frameCount = 0;
	const keyframeInterval = 3;
	let videoTrackProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
	let videoConsumer = new WritableStream({
		write(videoData) {
			if (!recording) return;
			const isKeyframe = frameCount % keyframeInterval === 0;
			videoEncoder.encode(videoData, { keyFrame: isKeyframe });
			videoData.close();

			frameCount++;
		}
	});
	videoTrackProcessor.readable.pipeTo(videoConsumer);

	startTime = document.timeline.currentTime;
	recording = true;
	lastKeyFrame = -Infinity;

	intervalId = setInterval(recordingTimer, 1000/30);
};
startRecordingButton.addEventListener('click', startRecording);

const recordingTimer = () => {
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
	videoTrack?.stop();

	await videoEncoder.flush();
	await audioEncoder.flush();
	muxer.finalize();

	videoEncoder = null;
	audioEncoder = null;
	muxer = null;
	startTime = null;

	startRecordingButton.style.display = 'block';
};
endRecordingButton.addEventListener('click', endRecording);

const downloadBlob = (blob) => {
	let url = window.URL.createObjectURL(blob);
	let a = document.createElement('a');
	a.style.display = 'none';
	a.href = url;
	a.download = 'picasso.webm';
	document.body.appendChild(a);
	a.click();
	window.URL.revokeObjectURL(url);
};