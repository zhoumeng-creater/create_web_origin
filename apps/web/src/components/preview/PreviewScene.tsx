import { useEffect, useMemo, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";

import { getAssetUrl } from "../../lib/api";
import type { PreviewConfig } from "../../types/previewConfig";

type BVHResult = {
  skeleton: THREE.Skeleton;
  clip: THREE.AnimationClip;
};

type AnimationPlaybackParams = {
  target: THREE.Object3D;
  clip: THREE.AnimationClip;
  playing: boolean;
  speed: number;
  seekTime: number | null;
  timelineDuration: number;
  isScrubbing: boolean;
  onTimeUpdate: (time: number) => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const findSkinnedMesh = (root: THREE.Object3D): THREE.SkinnedMesh | null => {
  let result: THREE.SkinnedMesh | null = null;
  root.traverse((child) => {
    if (result) {
      return;
    }
    if (child instanceof THREE.SkinnedMesh) {
      result = child;
    }
  });
  return result;
};

const tryRetargetClip = (
  target: THREE.Object3D,
  source: THREE.Skeleton,
  clip: THREE.AnimationClip
): THREE.AnimationClip => {
  const retargetClip = (SkeletonUtils as {
    retargetClip?: (
      target: THREE.Object3D,
      source: THREE.Object3D | THREE.Skeleton,
      clip: THREE.AnimationClip,
      options?: Record<string, unknown>
    ) => THREE.AnimationClip;
  }).retargetClip;
  if (!retargetClip) {
    return clip;
  }
  try {
    return retargetClip(target, source, clip, {
      useFirstFramePosition: true,
      preserveMatrix: true,
    });
  } catch {
    return clip;
  }
};

const useAnimationPlayback = ({
  target,
  clip,
  playing,
  speed,
  seekTime,
  timelineDuration,
  isScrubbing,
  onTimeUpdate,
}: AnimationPlaybackParams) => {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const timelineTimeRef = useRef(0);
  const lastNotifiedRef = useRef(0);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(target);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    mixerRef.current = mixer;
    actionRef.current = action;
    return () => {
      action.stop();
      mixer.stopAllAction();
      mixerRef.current = null;
      actionRef.current = null;
    };
  }, [clip, target]);

  useEffect(() => {
    if (seekTime === null || !Number.isFinite(seekTime)) {
      return;
    }
    const duration = Math.max(timelineDuration, 0.01);
    const nextTime = clamp(seekTime, 0, duration);
    timelineTimeRef.current = nextTime;
    const clipDuration = actionRef.current?.getClip().duration ?? 0;
    const clipTime = clipDuration > 0 ? nextTime % clipDuration : nextTime;
    if (mixerRef.current) {
      mixerRef.current.setTime(clipTime);
    }
    if (!isScrubbing) {
      onTimeUpdate(nextTime);
      lastNotifiedRef.current = nextTime;
    }
  }, [seekTime, timelineDuration, isScrubbing, onTimeUpdate]);

  useFrame((_, delta) => {
    if (!playing || !mixerRef.current || !actionRef.current) {
      return;
    }
    const scaledDelta = delta * speed;
    if (!Number.isFinite(scaledDelta) || scaledDelta <= 0) {
      return;
    }
    mixerRef.current.update(scaledDelta);
    const duration = Math.max(timelineDuration, 0.01);
    timelineTimeRef.current = (timelineTimeRef.current + scaledDelta) % duration;
    if (isScrubbing) {
      return;
    }
    const current = timelineTimeRef.current;
    if (Math.abs(current - lastNotifiedRef.current) >= 0.033) {
      lastNotifiedRef.current = current;
      onTimeUpdate(current);
    }
  });
};

const PanoramaBackground = ({ uri }: { uri: string }) => {
  const { scene } = useThree();
  const resolved = useMemo(() => getAssetUrl(uri), [uri]);
  const texture = useLoader(THREE.TextureLoader, resolved);

  useEffect(() => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    scene.background = texture;
    scene.environment = texture;
    return () => {
      if (scene.background === texture) {
        scene.background = null;
      }
      if (scene.environment === texture) {
        scene.environment = null;
      }
    };
  }, [scene, texture]);

  return null;
};

type RigProps = {
  bvh: BVHResult;
  playing: boolean;
  speed: number;
  seekTime: number | null;
  timelineDuration: number;
  isScrubbing: boolean;
  onTimeUpdate: (time: number) => void;
};

const SkeletonRig = ({
  bvh,
  playing,
  speed,
  seekTime,
  timelineDuration,
  isScrubbing,
  onTimeUpdate,
}: RigProps) => {
  const skeletonRoot = useMemo(
    () => bvh.skeleton.bones[0] ?? new THREE.Bone(),
    [bvh.skeleton]
  );
  const helper = useMemo(() => new THREE.SkeletonHelper(skeletonRoot), [skeletonRoot]);

  useEffect(() => {
    helper.material.color.setHex(0x7dd3fc);
  }, [helper]);

  useAnimationPlayback({
    target: skeletonRoot,
    clip: bvh.clip,
    playing,
    speed,
    seekTime,
    timelineDuration,
    isScrubbing,
    onTimeUpdate,
  });

  return (
    <group>
      <primitive object={skeletonRoot} />
      <primitive object={helper} />
    </group>
  );
};

type ModelRigProps = RigProps & {
  modelUri: string;
};

const ModelRig = ({
  modelUri,
  bvh,
  playing,
  speed,
  seekTime,
  timelineDuration,
  isScrubbing,
  onTimeUpdate,
}: ModelRigProps) => {
  const resolved = useMemo(() => getAssetUrl(modelUri), [modelUri]);
  const gltf = useLoader(GLTFLoader, resolved) as GLTF;
  const model = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);
  const skinnedMesh = useMemo(() => findSkinnedMesh(model), [model]);
  const retargetedClip = useMemo(() => {
    if (!skinnedMesh) {
      return bvh.clip;
    }
    return tryRetargetClip(skinnedMesh, bvh.skeleton, bvh.clip);
  }, [skinnedMesh, bvh.clip, bvh.skeleton]);

  useAnimationPlayback({
    target: model,
    clip: retargetedClip,
    playing,
    speed,
    seekTime,
    timelineDuration,
    isScrubbing,
    onTimeUpdate,
  });

  return <primitive object={model} />;
};

type PreviewSceneProps = {
  config: PreviewConfig;
  playing: boolean;
  speed: number;
  seekTime: number | null;
  timelineDuration: number;
  isScrubbing: boolean;
  onTimeUpdate: (time: number) => void;
  onClipDuration: (duration: number) => void;
  onReady: () => void;
};

export const PreviewScene = ({
  config,
  playing,
  speed,
  seekTime,
  timelineDuration,
  isScrubbing,
  onTimeUpdate,
  onClipDuration,
  onReady,
}: PreviewSceneProps) => {
  const bvhUrl = useMemo(() => getAssetUrl(config.motion.bvh_uri), [config.motion.bvh_uri]);
  const bvh = useLoader(BVHLoader, bvhUrl) as BVHResult;

  useEffect(() => {
    if (Number.isFinite(bvh.clip.duration) && bvh.clip.duration > 0) {
      onClipDuration(bvh.clip.duration);
    }
    onReady();
  }, [bvh.clip, onClipDuration, onReady]);

  const enableOrbit = config.camera?.preset === "orbit";
  const autoRotate = Boolean(config.camera?.auto_rotate);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[2, 4, 3]} intensity={0.8} />
      {config.scene?.panorama_uri ? (
        <PanoramaBackground uri={config.scene.panorama_uri} />
      ) : null}
      {config.character?.model_uri ? (
        <ModelRig
          modelUri={config.character.model_uri}
          bvh={bvh}
          playing={playing}
          speed={speed}
          seekTime={seekTime}
          timelineDuration={timelineDuration}
          isScrubbing={isScrubbing}
          onTimeUpdate={onTimeUpdate}
        />
      ) : (
        <SkeletonRig
          bvh={bvh}
          playing={playing}
          speed={speed}
          seekTime={seekTime}
          timelineDuration={timelineDuration}
          isScrubbing={isScrubbing}
          onTimeUpdate={onTimeUpdate}
        />
      )}
      {enableOrbit ? (
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          autoRotate={autoRotate}
          autoRotateSpeed={0.6}
        />
      ) : null}
    </>
  );
};
