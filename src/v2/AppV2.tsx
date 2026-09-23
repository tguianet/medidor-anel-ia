import { useMemo, useState } from "react";
import { classifyFingerWidthMm, FINGER_REFERENCE_CURVE, INITIAL_REFERENCE_FINGER_WIDTH_MM } from "./ringClassifier";
import { PHYSICAL_RING_TABLE } from "./physicalRingTable";

export default function AppV2() {
  const [fingerMm,setFingerMm]=useState(INITIAL_REFERENCE_FINGER_WIDTH_MM.toFixed(2));

  const numericMm=Number(fingerMm.replace(",","."));
  const result=useMemo(()=>{
    try{
      return classifyFingerWidthMm(numericMm);
    }catch{
      return null;
    }
  },[numericMm]);

  return (
    <main style={{fontFamily:"Inter,system-ui,sans-serif",maxWidth:980,margin:"0 auto",padding:"24px"}}>
      <header style={{marginBottom:24}}>
        <div style={{fontSize:12,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",opacity:.6}}>Medidor de Anel 2.0</div>
        <h1 style={{margin:"6px 0 8px",fontSize:32}}>Teste limpo mm → aro</h1>
        <p style={{margin:0,opacity:.72,lineHeight:1.5}}>
          Esta tela nao usa a curva antiga, MAB, offsets historicos ou regras aprendidas.
          Ela recebe apenas a largura do dedo em milimetros e consulta a regua fisica da V2.
        </p>
      </header>

      <section style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(280px,.7fr)",gap:18,alignItems:"start"}}>
        <div style={{border:"1px solid #ddd",borderRadius:16,padding:20}}>
          <label style={{display:"block",fontWeight:700,marginBottom:8}}>Largura medida do dedo (mm)</label>
          <input
            value={fingerMm}
            onChange={(event)=>setFingerMm(event.target.value)}
            inputMode="decimal"
            style={{width:"100%",boxSizing:"border-box",fontSize:28,padding:"14px 16px",borderRadius:12,border:"1px solid #bbb"}}
          />

          {result ? (
            <div style={{marginTop:18,display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12}}>
              <Metric label="Aro exato" value={String(result.exactRingSize)} />
              <Metric label="Aro conforto" value={String(result.comfortRingSize)} />
              <Metric label="Centro deste aro" value={result.targetWidthMm.toFixed(3)+" mm"} />
              <Metric label="Diferenca para o centro" value={(result.distanceFromTargetMm>=0?"+":"")+result.distanceFromTargetMm.toFixed(3)+" mm"} />
              <Metric label="Limite inferior" value={Number.isFinite(result.lowerBoundaryMm)?result.lowerBoundaryMm.toFixed(3)+" mm":"-∞"} />
              <Metric label="Limite superior" value={Number.isFinite(result.upperBoundaryMm)?result.upperBoundaryMm.toFixed(3)+" mm":"+∞"} />
            </div>
          ) : (
            <div style={{marginTop:16,padding:14,borderRadius:12,background:"#f6f6f6"}}>Digite uma medida valida em mm.</div>
          )}
        </div>

        <aside style={{border:"1px solid #ddd",borderRadius:16,padding:20}}>
          <div style={{fontWeight:700,marginBottom:10}}>Marco inicial</div>
          <div style={{fontSize:28,fontWeight:800}}>Aro 29 = {INITIAL_REFERENCE_FINGER_WIDTH_MM.toFixed(2)} mm</div>
          <p style={{opacity:.7,lineHeight:1.5}}>
            Os demais aros sao construidos acumulando apenas o crescimento fisico medido no paquimetro.
          </p>
        </aside>
      </section>

      <section style={{marginTop:24}}>
        <h2 style={{fontSize:22}}>Regua V2</h2>
        <div style={{overflowX:"auto",border:"1px solid #ddd",borderRadius:16}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:720}}>
            <thead>
              <tr style={{textAlign:"left",background:"#f7f7f7"}}>
                <Th>Aro</Th><Th>Centro dedo</Th><Th>Limite inferior</Th><Th>Limite superior</Th><Th>Media anel fisico</Th><Th>Crescimento fisico</Th>
              </tr>
            </thead>
            <tbody>
              {FINGER_REFERENCE_CURVE.map((entry)=>{
                const ring=PHYSICAL_RING_TABLE.find((item)=>item.size===entry.ringSize);
                return (
                  <tr key={entry.ringSize} style={{borderTop:"1px solid #eee"}}>
                    <Td>{entry.ringSize}</Td>
                    <Td>{entry.targetWidthMm.toFixed(3)} mm</Td>
                    <Td>{Number.isFinite(entry.lowerBoundaryMm)?entry.lowerBoundaryMm.toFixed(3):"-∞"}</Td>
                    <Td>{Number.isFinite(entry.upperBoundaryMm)?entry.upperBoundaryMm.toFixed(3):"+∞"}</Td>
                    <Td>{ring?.meanDiameterMm.toFixed(3)} mm</Td>
                    <Td>{ring?.growthFromPreviousMm==null?"—":(ring.growthFromPreviousMm>=0?"+":"")+ring.growthFromPreviousMm.toFixed(3)+" mm"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Metric({label,value}:{label:string;value:string}){
  return <div style={{padding:14,borderRadius:12,background:"#f7f7f7"}}><div style={{fontSize:12,opacity:.6,marginBottom:4}}>{label}</div><div style={{fontSize:22,fontWeight:800}}>{value}</div></div>;
}
function Th({children}:{children:React.ReactNode}){ return <th style={{padding:"12px 14px",fontSize:13}}>{children}</th>; }
function Td({children}:{children:React.ReactNode}){ return <td style={{padding:"11px 14px",fontSize:14}}>{children}</td>; }
