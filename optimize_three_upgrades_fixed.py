#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds
from scipy.sparse import lil_matrix

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'ffh_requested_predictions_gw1-6.json'
OUT = ROOT / 'best_three_upgrades_gw1-6.json'
CURRENT = {'Verbruggen','Kinsky','Konsa','Kayode','Maguire','Vuskovic','Hume','Gross','Wirtz','Semenyo','Mbeumo','Sangare M','Thiago','DCL','Haaland'}
BENCH_BOOST_GW = 3
BUDGET = 100.0
GWS = list(range(1, 7))

p = json.loads(SOURCE.read_text(encoding='utf-8'))
players = [x for x in p['players'] if not x.get('positionMismatch') and x.get('requestedName') not in {'Raya','Foden','Lamens'}]
# Avoid duplicate entries for the same source player/request if any.
seen = set(); unique=[]
for x in players:
    key=(x.get('fullName'), x.get('position'), (x.get('team') or {}).get('shortName'))
    if key not in seen:
        unique.append(x); seen.add(key)
players=unique
n=len(players)
positions=['GK','DEF','MID','FWD']
teams=sorted({(x.get('team') or {}).get('shortName') for x in players})

def points(i, gw):
    for f in players[i].get('fixtures',[]):
        if f.get('gameweek') == gw:
            return float((f.get('predictions') or {}).get('points') or 0)
    return 0.0

def idx_s(i): return i
base_x=n
base_c=base_x+n*6
def idx_x(i,g): return base_x+g*n+i
def idx_c(i,g): return base_c+g*n+i
nv=base_c+n*6
c=np.zeros(nv)
for i in range(n):
    for g,gw in enumerate(GWS):
        if gw == BENCH_BOOST_GW:
            c[idx_s(i)] -= points(i,gw)
        else:
            c[idx_x(i,g)] = -points(i,gw)
        c[idx_c(i,g)] = -points(i,gw)  # captain is the extra copy
integrality=np.ones(nv)
lb=np.zeros(nv); ub=np.ones(nv)
rows=[]; lower=[]; upper=[]
def add(co, lo, hi):
    rows.append(co); lower.append(lo); upper.append(hi)
# budget
add([(i,float(players[i].get('price') or 0)) for i in range(n)], -np.inf, BUDGET)
# squad composition
for pos, count in [('GK',2),('DEF',5),('MID',5),('FWD',3)]:
    add([(i,1) for i,x in enumerate(players) if x.get('position')==pos], count, count)
# max 3 per club
for team in teams:
    add([(i,1) for i,x in enumerate(players) if (x.get('team') or {}).get('shortName')==team], -np.inf, 3)
add([(i,1) for i,x in enumerate(players) if x.get('requestedName') not in CURRENT], -np.inf, 3)
# Each GW lineup and captain constraints
for g,gw in enumerate(GWS):
    add([(idx_x(i,g),1) for i in range(n)], 11, 11)
    add([(idx_x(i,g),1) for i,x in enumerate(players) if x.get('position')=='GK'], 1, 1)
    add([(idx_x(i,g),1) for i,x in enumerate(players) if x.get('position')=='DEF'], 3, 5)
    add([(idx_x(i,g),1) for i,x in enumerate(players) if x.get('position')=='MID'], 2, 5)
    add([(idx_x(i,g),1) for i,x in enumerate(players) if x.get('position')=='FWD'], 1, 3)
    add([(idx_c(i,g),1) for i in range(n)], 1, 1)
    # starters/captains cannot exceed squad membership
    for i in range(n):
        add([(idx_x(i,g),1),(idx_s(i),-1)], -np.inf, 0)
        add([(idx_c(i,g),1),(idx_x(i,g),-1)], -np.inf, 0)
A=lil_matrix((len(rows),nv),dtype=float)
for r,co in enumerate(rows):
    for j,v in co: A[r,j]=v
res=milp(c, integrality=integrality, bounds=Bounds(lb,ub), constraints=LinearConstraint(A.tocsr(), np.array(lower), np.array(upper)), options={'time_limit':120})
if not res.success:
    raise SystemExit(f'optimization failed: {res.message}')
y=res.x
squad=[players[i] for i in range(n) if y[idx_s(i)]>.5]
result={'source':str(SOURCE),'assumptions':{'budget':BUDGET,'squad':'2 GK, 5 DEF, 5 MID, 3 FWD','maxPerClub':3,'maxInitialTransfers':3,'noTransfers':'one fixed squad for GW1-GW6 after the initial upgrades','captain':'optimised independently each GW; double points included','benchBoostGameweek':BENCH_BOOST_GW},'objectivePredictedPoints':round(float(-res.fun),4),'squad':[], 'gameweeks':[]}
for x in squad:
    result['squad'].append({'name':x.get('fullName'),'shortName':x.get('requestedName'),'position':x.get('position'),'price':x.get('price'),'team':x.get('team')})
for g,gw in enumerate(GWS):
    starters=[(i,players[i]) for i in range(n) if y[idx_x(i,g)]>.5]
    captain=next(players[i] for i in range(n) if y[idx_c(i,g)]>.5)
    if gw == BENCH_BOOST_GW:
        total=sum(points(i,gw) for i in range(n) if y[idx_s(i)]>.5)+points(players.index(captain),gw)
    else:
        total=sum(points(i,gw) for i,_ in starters)+points(next(i for i,x in starters if x is captain),gw)
    result['gameweeks'].append({'gameweek':gw,'predictedPoints':round(total,4),'captain':{'name':captain.get('fullName'),'team':captain.get('team'),'predictedPoints':round(points(players.index(captain),gw),4)},'starters':[{'name':x.get('fullName'),'shortName':x.get('requestedName'),'position':x.get('position'),'team':x.get('team'),'predictedPoints':round(points(i,gw),4)} for i,x in starters]})
result['squadCost']=round(sum(float(x.get('price') or 0) for x in squad),1)
OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'ok','output':str(OUT),'squadCost':result['squadCost'],'objectivePredictedPoints':result['objectivePredictedPoints'],'squadCount':len(squad),'gameweekTotals':[x['predictedPoints'] for x in result['gameweeks']]},ensure_ascii=False,indent=2))
