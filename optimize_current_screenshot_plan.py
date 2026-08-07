#!/usr/bin/env python3
from __future__ import annotations
import json
import sys
from pathlib import Path
import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds
from scipy.sparse import lil_matrix

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'ffh_requested_predictions_gw1-6.json'
BB_GW=int(sys.argv[1]) if len(sys.argv)>1 else 1
if BB_GW not in (1,2,3): raise SystemExit('Bench Boost GW must be 1, 2, or 3')
OUT=ROOT/'best_current_screenshot_plan_gw1-6.json'
CURRENT={'Verbruggen','Kinsky','Gabriel','Kayode','Shaw','Canvot','Konsa','Semenyo','Mbeumo','Wirtz','Gross','Sangare M','Haaland','Thiago','DCL'}
BUDGET=100.0
GWS=list(range(1,7))
raw=json.loads(SOURCE.read_text(encoding='utf-8'))
players=[x for x in raw['players'] if not x.get('positionMismatch') and x.get('requestedName') not in {'Raya','Foden','Lamens'}]
seen=set(); ps=[]
for x in players:
    k=(x.get('fullName'),x.get('position'),(x.get('team') or {}).get('shortName'))
    if k not in seen: ps.append(x); seen.add(k)
players=ps; n=len(players); teams=sorted({(x.get('team') or {}).get('shortName') for x in players})

def pts(i,g):
    for f in players[i].get('fixtures',[]):
        if f.get('gameweek')==g: return float((f.get('predictions') or {}).get('points') or 0)
    return 0.0
# variables: squad, starter, captain for every GW; transfer in/out for transitions; bank after each GW
S=0; X=S+n*6; C=X+n*6; IN=C+n*6; OUTV=IN+n*5; BANK=OUTV+n*5; nv=BANK+6
isq=lambda i,g:S+g*n+i
ix=lambda i,g:X+g*n+i
ic=lambda i,g:C+g*n+i
iin=lambda i,g:IN+g*n+i
iout=lambda i,g:OUTV+g*n+i
ib=lambda g:BANK+g
obj=np.zeros(nv)
for g,gw in enumerate(GWS):
    for i in range(n):
        if gw==BB_GW:
            obj[isq(i,g)]=-pts(i,gw)
        else:
            obj[ix(i,g)]=-pts(i,gw)
        obj[ic(i,g)]=-pts(i,gw)
integrality=np.ones(nv); lo=np.zeros(nv); hi=np.ones(nv)
# bank is integer 0..5, transfers binary
hi[BANK:BANK+6]=5
rows=[]; lows=[]; highs=[]
def add(co,lo_,hi_): rows.append(co); lows.append(lo_); highs.append(hi_)
for g in range(6):
    add([(isq(i,g),players[i].get('price') or 0) for i in range(n)],-np.inf,BUDGET)
    for pos,k in [('GK',2),('DEF',5),('MID',5),('FWD',3)]:
        add([(isq(i,g),1) for i,x in enumerate(players) if x.get('position')==pos],k,k)
    for t in teams: add([(isq(i,g),1) for i,x in enumerate(players) if (x.get('team') or {}).get('shortName')==t],-np.inf,3)
    if g==0:
        for i,x in enumerate(players):
            add([(isq(i,g),1)],1 if x.get('requestedName') in CURRENT else 0,1 if x.get('requestedName') in CURRENT else 0)
    # Szoboszlai and Schade are excluded from every future squad.
    for name in ('Szoboslai','Schade'):
        add([(isq(i,g),1) for i,x in enumerate(players) if x.get('requestedName')==name],0,0)
    for name in ('Wirtz','Sangare M'):
        add([(isq(i,g),1) for i,x in enumerate(players) if x.get('requestedName')==name],1,1)
    # Maatsen is excluded entirely.
    add([(isq(i,g),1) for i,x in enumerate(players) if x.get('requestedName')=='Maatsen'],0,0)
    # Palmer must replace Mbeumo before GW4 and captain GW4.
    if g < 3:
        add([(isq(i,g),1) for i,x in enumerate(players) if x.get('requestedName')=='Mbeumo'],1,1)
        add([(isq(i,g),1) for i,x in enumerate(players) if x.get('requestedName')=='Palmer'],0,0)
    else:
        add([(isq(i,g),1) for i,x in enumerate(players) if x.get('requestedName')=='Mbeumo'],0,0)
        add([(isq(i,g),1) for i,x in enumerate(players) if x.get('requestedName')=='Palmer'],1,1)
    add([(ix(i,g),1) for i in range(n)],11,11)
    add([(ix(i,g),1) for i,x in enumerate(players) if x.get('position')=='GK'],1,1)
    add([(ix(i,g),1) for i,x in enumerate(players) if x.get('position')=='DEF'],3,5)
    add([(ix(i,g),1) for i,x in enumerate(players) if x.get('position')=='MID'],2,5)
    add([(ix(i,g),1) for i,x in enumerate(players) if x.get('position')=='FWD'],1,3)
    add([(ic(i,g),1) for i in range(n)],1,1)
    if g==3:
        add([(ic(i,g),1) for i,x in enumerate(players) if x.get('requestedName')=='Palmer'],1,1)
    for i in range(n):
        add([(ix(i,g),1),(isq(i,g),-1)],-np.inf,0)
        add([(ic(i,g),1),(ix(i,g),-1)],-np.inf,0)
# initial bank: 1 free transfer available after GW1
add([(ib(0),1)],1,1)
for g in range(1,6):
    # squad change equals transfer in minus transfer out
    for i in range(n): add([(isq(i,g),1),(isq(i,g-1),-1),(iin(i,g-1),-1),(iout(i,g-1),1)],0,0)

    # bank cannot exceed 5, and can use no more than available bank + new free transfer
    add([(iin(i,g-1),1) for i in range(n)]+[(ib(g-1),-1)],-np.inf,0)
    # after transfers: bank_g <= bank_prev + 1 - transfers; bank_g >= bank_prev - transfers
    add([(ib(g),1),(ib(g-1),-1)]+[(iin(i,g-1),1) for i in range(n)],-np.inf,1)
    add([(ib(g),1),(ib(g-1),-1)]+[(iin(i,g-1),1) for i in range(n)],0,np.inf)
A=lil_matrix((len(rows),nv),dtype=float)
for r,co in enumerate(rows):
    for j,v in co:A[r,j]=v
res=milp(obj,integrality=integrality,bounds=Bounds(lo,hi),constraints=LinearConstraint(A.tocsr(),np.array(lows),np.array(highs)),options={'time_limit':180})
if not res.success: raise SystemExit(res.message)
y=res.x

def player_out(i):
    p=players[i]; return {'name':p.get('fullName'),'shortName':p.get('requestedName'),'position':p.get('position'),'price':p.get('price'),'team':p.get('team')}
result={'source':str(SOURCE),'assumptions':{'budget':'£100m per squad snapshot; price changes ignored because no future price data','squad':'2 GK, 5 DEF, 5 MID, 3 FWD','maxPerClub':3,'freeTransfers':'1 per GW; unused transfers carried; maximum bank 5','transferHits':'none; never exceeds available free transfers','captain':'optimised each GW; double points included','benchBoostGameweek':BB_GW,'chips':'Bench Boost only'},'objectivePredictedPoints':round(float(-res.fun),4),'squadCostByGW':[],'transfers':[],'gameweeks':[]}
for g,gw in enumerate(GWS):
    ids=[i for i in range(n) if y[isq(i,g)]>.5]
    result['squadCostByGW'].append({'gameweek':gw,'cost':round(sum(float(players[i].get('price') or 0) for i in ids),1),'freeTransfersBankAfterGW':round(y[ib(g)])})
    if g>0:
        ins=[i for i in range(n) if y[iin(i,g-1)]>.5]; outs=[i for i in range(n) if y[iout(i,g-1)]>.5]
        result['transfers'].append({'beforeGameweek':gw,'freeTransfersUsed':len(ins),'in':[player_out(i) for i in ins],'out':[player_out(i) for i in outs]})
    starts=[i for i in range(n) if y[ix(i,g)]>.5]; cap=next(i for i in range(n) if y[ic(i,g)]>.5)
    if gw==BB_GW:
        total=sum(pts(i,gw) for i in ids)+pts(cap,gw)
    else:
        total=sum(pts(i,gw) for i in starts)+pts(cap,gw)
    result['gameweeks'].append({'gameweek':gw,'benchBoost':gw==BB_GW,'predictedPoints':round(total,4),'captain':{**player_out(cap),'predictedPoints':round(pts(cap,gw),4)},'starters':[{'name':players[i].get('fullName'),'shortName':players[i].get('requestedName'),'position':players[i].get('position'),'team':players[i].get('team'),'predictedPoints':round(pts(i,gw),4)} for i in starts],'bench':[{'name':players[i].get('fullName'),'shortName':players[i].get('requestedName'),'position':players[i].get('position'),'team':players[i].get('team'),'predictedPoints':round(pts(i,gw),4)} for i in ids if i not in starts]})
OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'ok','output':str(OUT),'objectivePredictedPoints':result['objectivePredictedPoints'],'gwTotals':[x['predictedPoints'] for x in result['gameweeks']],'transfersUsed':[x['freeTransfersUsed'] for x in result['transfers']]},ensure_ascii=False,indent=2))
