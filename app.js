const api="http://localhost:5000";
const canvas=document.getElementById("treeCanvas");
const ctx=canvas.getContext("2d");
const tooltip=document.getElementById("tooltip");

let treeNodes={},currentNodes={},animating=false,serverChain={},headSlot=null;

// ----------------------
// API and status
// ----------------------
async function getStatus(){
    const res=await fetch(`${api}/status`);
    const data=await res.json();
    serverChain=data.chain;

    // validators
    const validatorsDiv=document.getElementById("validators");
    validatorsDiv.innerHTML="";
    data.validators.forEach(v=>{
        const div=document.createElement("div");
        div.className=`validator ${v.faulty?"faulty":"active"}`;
        div.innerHTML=`<span>Validator #${v.id}</span> <button onclick="toggleFault(${v.id})">${v.faulty?"Recover":"Fault"}</button>`;
        validatorsDiv.appendChild(div);
    });

    document.getElementById("slot").textContent=data.current_slot;
    document.getElementById("finalized").textContent=data.finalized_slot;

    layoutTree(data.chain);
    headSlot=data.head;
    if(!animating) animateTree();
}

async function simulateSlot(){
    await fetch(`${api}/simulate_slot`,{method:"POST"});
    await getStatus();
}

async function toggleFault(id){
    await fetch(`${api}/toggle_fault`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id})
    });
    await getStatus();
}

// ----------------------
// Tree layout with fork
function layoutTree(chain){
    const slots=Object.keys(chain).sort((a,b)=>parseFloat(a)-parseFloat(b));
    const xStep=140, yStep=60, xStart=100;
    treeNodes={};
    let levelCounters={};

    for(const slot of slots){
        const blocks = chain[slot] || [];
        if(!levelCounters[slot]) levelCounters[slot]=0;

        blocks.forEach((block,i)=>{
            const x=xStart + parseInt(slot)*xStep;
            const y=50 + (levelCounters[slot]+i)*yStep;
            treeNodes[slot+"_"+i]={x,y,finalized:block.finalized,parent:block.parent,slot:block.slot,votes:block.votes};
            if(!currentNodes[slot+"_"+i]) currentNodes[slot+"_"+i]={x:x, y:0}; // рост снизу
        });
        levelCounters[slot]+=blocks.length;
    }

    // auto-expand canvas
    const maxX=Math.max(...Object.values(treeNodes).map(n=>n.x))+200;
    canvas.width=Math.max(maxX,1600);
}

// ----------------------
// Animation
function animateTree(){
    animating=true;
    let done=true;
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // parent->child lines
    for(const key in treeNodes){
        const node=treeNodes[key];
        if(node.parent){
            // find all parent blocks
            const parentKeys=Object.keys(treeNodes).filter(k=>treeNodes[k].slot==node.parent);
            parentKeys.forEach(pk=>{
                const p=currentNodes[pk];
                const n=currentNodes[key];
                if(p){
                    ctx.strokeStyle="#888";
                    ctx.lineWidth=2;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(n.x, n.y);
                    ctx.stroke();
                }
            });
        }
    }

    // smooth growth blocks
    for(const key in treeNodes){
        const target=treeNodes[key];
        const node=currentNodes[key];

        // smooth growth
        node.x+=(target.x-node.x)*0.1;
        node.y+=(target.y-node.y)*0.1;
        if(Math.abs(node.x-target.x)>0.5 || Math.abs(node.y-target.y)>0.5) done=false;

        // fork branch color with gradient
        let hue = (parseInt(target.slot)*30 + parseInt(key.split("_")[1])*20) % 360;
        let color = target.finalized ? "#1a7f37" : `hsl(${hue},70%,50%)`;
        if(target.slot==headSlot) color="#FFD700";

        ctx.fillStyle=color;
        ctx.fillRect(node.x-22, node.y-22, 44, 44);

        // text
        ctx.fillStyle="#fff";
        ctx.font="12px Arial";
        ctx.textAlign="center";
        ctx.textBaseline="middle";
        ctx.fillText(target.slot,node.x,node.y);
    }

    if(!done) requestAnimationFrame(animateTree);
    else animating=false;
}

// ----------------------
// Tooltip and parent chain highlighting
canvas.addEventListener("mousemove", e=>{
    const rect=canvas.getBoundingClientRect();
    const mouseX=e.clientX-rect.left;
    const mouseY=e.clientY-rect.top;
    let found=false;

    animateTree();

    for(const key in treeNodes){
        const n=currentNodes[key];
        if(mouseX>=n.x-22 && mouseX<=n.x+22 && mouseY>=n.y-22 && mouseY<=n.y+22){
            const info=treeNodes[key];

            tooltip.innerHTML=`<strong>Slot:</strong> ${info.slot}<br>
                               <strong>Finalized:</strong> ${info.finalized}<br>
                               <strong>Validators voted:</strong> ${info.votes.join(', ')}`;
            tooltip.style.left=e.pageX+12+"px";
            tooltip.style.top=e.pageY+12+"px";
            tooltip.style.display="block";

            // highlighting the entire parent chain
            let currentKey = key;
            ctx.strokeStyle="#00FFFF";
            ctx.lineWidth=3;
            while(currentKey){
                const node=treeNodes[currentKey];
                if(node && node.parent){
                    const parentKeys=Object.keys(treeNodes).filter(k=>treeNodes[k].slot==node.parent);
                    if(parentKeys.length>0){
                        const pk=parentKeys[0];
                        const p=currentNodes[pk];
                        const c=currentNodes[currentKey];
                        ctx.beginPath();
                        ctx.moveTo(p.x,p.y);
                        ctx.lineTo(c.x,c.y);
                        ctx.stroke();
                        currentKey=pk;
                    } else break;
                } else break;
            }

            found=true;
            break;
        }
    }
    if(!found) tooltip.style.display="none";
});

canvas.addEventListener("mouseleave",()=>{ tooltip.style.display="none"; });

// auto-refresh every 2 seconds
setInterval(getStatus,2000);
getStatus();









