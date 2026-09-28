import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type DeviceCaptureQuality = {
  available:boolean;
  permission:"unknown"|"granted"|"denied"|"not-required";
  devicePitch:number | null;
  deviceRoll:number | null;
  deviceMotion:number | null;
  stabilityScore:number | null;
};

type PermissionCtor = typeof DeviceMotionEvent & {
  requestPermission?:()=>Promise<"granted"|"denied">;
};

export function useDeviceCaptureQuality(enabled:boolean) {
  const [permission,setPermission]=useState<DeviceCaptureQuality["permission"]>("unknown");
  const [pitch,setPitch]=useState<number|null>(null);
  const [roll,setRoll]=useState<number|null>(null);
  const [motion,setMotion]=useState<number|null>(null);
  const motionEma=useRef(0);

  const available=useMemo(
    ()=>enabled && (typeof DeviceOrientationEvent!=="undefined" || typeof DeviceMotionEvent!=="undefined"),
    [enabled],
  );

  const requestPermission=useCallback(async()=>{
    if(!enabled || typeof window==="undefined") return;
    try{
      const ctor=DeviceMotionEvent as PermissionCtor;
      if(typeof ctor?.requestPermission==="function"){
        const result=await ctor.requestPermission();
        setPermission(result);
      }else{
        setPermission("not-required");
      }
    }catch{
      setPermission("denied");
    }
  },[enabled]);

  useEffect(()=>{
    if(!enabled || typeof window==="undefined") return;

    const onOrientation=(event:DeviceOrientationEvent)=>{
      if(typeof event.beta==="number") setPitch(event.beta);
      if(typeof event.gamma==="number") setRoll(event.gamma);
    };
    const onMotion=(event:DeviceMotionEvent)=>{
      const a=event.acceleration;
      const r=event.rotationRate;
      const linear=Math.hypot(a?.x ?? 0,a?.y ?? 0,a?.z ?? 0);
      const rotation=Math.hypot(r?.alpha ?? 0,r?.beta ?? 0,r?.gamma ?? 0)/90;
      const value=Math.min(20,linear+rotation);
      motionEma.current=motionEma.current*.82+value*.18;
      setMotion(motionEma.current);
    };

    window.addEventListener("deviceorientation",onOrientation,{passive:true});
    window.addEventListener("devicemotion",onMotion,{passive:true});
    return ()=>{
      window.removeEventListener("deviceorientation",onOrientation);
      window.removeEventListener("devicemotion",onMotion);
    };
  },[enabled,permission]);

  const stabilityScore=useMemo(()=>{
    if(!available) return null;
    if(motion===null) return 100;
    return Math.max(0,Math.min(100,Math.round(100-motion*18)));
  },[available,motion]);

  return {
    available,
    permission,
    devicePitch:pitch,
    deviceRoll:roll,
    deviceMotion:motion,
    stabilityScore,
    requestPermission,
  };
}
