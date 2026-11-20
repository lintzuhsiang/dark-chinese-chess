"""Existing-results-only factorial analysis; never chooses checkpoints or seeds."""
import argparse
import csv
import json
from pathlib import Path
import statistics

import numpy as np

from scripts.ai7_p0.common import paired_statistics


def produce(root, config, status, *, output=None, games_dir=None):
    from .campaign import EFFECTS, SEEDS, TARGET, atomic, read
    from scripts.ai7.shared_protocol import sha256
    output = root if output is None else output
    games_dir = root/'games' if games_dir is None else games_dir
    records=[]; contrasts=[]; series={}
    for job in config['jobs']:
        run=root/'runs'/job['id']; summary=read(run/'summary.json',{})
        logs=[json.loads(line) for line in (run/'metrics.jsonl').read_text().splitlines()] if (run/'metrics.jsonl').exists() else []
        records.append({**job,'status':summary.get('status','not_started'),'env_steps':summary.get('env_steps',0),
            'training_seconds':summary.get('actual_training_seconds'), 'completed_games':summary.get('completed_games'),
            'PPO_steps':summary.get('optimizer_steps'),
            'extra_critic_steps':sum(m.get('extra_critic_steps',0) for m in logs),
            'extra_critic_seconds':sum(m.get('extra_critic_seconds',0) for m in logs),
            'initial_and_milestones':'preserved in per-run checkpoint files; final only is primary endpoint'})
        series[job['id']]=logs
    games = [read(p) for p in sorted(games_dir.glob('*.json'))]
    matchup_ids = set()
    manifest = read(root/'shared-evaluation-manifest.json', {})
    if games and (not manifest or sha256(root/'shared-evaluation-manifest.json') != config['shared_manifest_sha256']):
        raise ValueError("Report inputs require the exact frozen campaign manifest")
    expected_decks = set(manifest.get('deck_seeds', []))
    expected_opponents = {row['name'] for row in manifest.get('opponents', [])}
    allowed_jobs = {(row['treatment'], row['seed']) for row in config['jobs']}
    for game_report in games:
        checkpoint = game_report.get('checkpoint_identity', game_report.get('checkpoint'))
        identity = (checkpoint['treatment'], checkpoint['seed'])
        opponent = game_report['opponent']
        matchup = (*identity, opponent)
        legs = {(g['seed'], g['seat']) for g in game_report['games']}
        decks = {seed for seed, _ in legs}
        if (checkpoint['endpoint'] != 'final' or checkpoint['env_steps'] != TARGET
                or identity not in allowed_jobs or matchup in matchup_ids or opponent not in expected_opponents
                or game_report['manifest_sha256'] != config['shared_manifest_sha256']
                or game_report['completed'] != 512 or len(game_report['games']) != 512
                or len(decks) != 256 or decks != expected_decks
                or legs != {(deck, seat) for deck in decks for seat in (0, 1)}):
            raise ValueError(f"Inconsistent final matchup data: {matchup}")
        matchup_ids.add(matchup)
        game_report['checkpoint'] = checkpoint
    tactical=read(root/'tactical-results.json',[])
    calibration=read(root/'calibration-results.json',[])
    def effects(kind,lookup,metrics,unit,resamples,seed):
        for metric in metrics:
            for training_seed in SEEDS:
                for effect,weights in EFFECTS.items():
                    if any((method,training_seed) not in lookup for method in weights): continue
                    arrays={m:lookup[(m,training_seed)][metric] for m in weights}
                    assert len({len(v) for v in arrays.values()})==1
                    diff=sum(w*np.asarray(arrays[m]) for m,w in weights.items())
                    interval=paired_statistics(diff,resamples=resamples,seed=seed)
                    interval['unit']=unit
                    contrasts.append({'domain':kind,'metric':metric,'training_seed':training_seed,'effect':effect,
                        'formula':weights,'difference':interval['mean'],'conditional95':interval['percentile95'],
                        'resamples':resamples,'bootstrap_seed':seed,'unit':unit,'pairs':len(diff)})
    def vector(report,metric):
        buckets={}
        for game in report['games']:
            outcome=game['result']; draw=outcome['type']=='DRAW'
            win=not draw and outcome['winner']==('P1' if game['seat']==0 else 'P2')
            values={'score':1. if win else .5 if draw else 0.,'win_rate':float(win),'loss_rate':float(not win and not draw),
                    'no_progress_rate':float(outcome['reason']=='NO_PROGRESS'),'game_length':game['plies']}
            buckets.setdefault(game['seed'],[]).append(values[metric])
        assert all(len(v)==2 for v in buckets.values()) and len(buckets)==256
        return [float(np.mean(buckets[s])) for s in sorted(buckets)]
    for opponent in sorted({g['opponent'] for g in games}):
        metrics=['score','win_rate','loss_rate','no_progress_rate','game_length']
        lookup={(g['checkpoint']['treatment'],g['checkpoint']['seed']):{m:vector(g,m) for m in metrics}
                for g in games if g['opponent']==opponent and g['completed']==512}
        effects('games:'+opponent,lookup,metrics,'deck pairs; conditional on fixed policies',10000,19)
    for category in ['win','defense']:
        metrics=['target_probability','top1_accuracy','best_target_rank','equivariance_tv']
        lookup={(r['checkpoint']['treatment'],r['checkpoint']['seed']):
                {m:[p[m] for p in r['positions'] if p['category']==category] for m in metrics}
                for r in tactical if r['checkpoint']['endpoint']=='final'}
        effects('tactical:'+category,lookup,metrics,'source positions; orientations averaged; conditional on policies',4000,91023)
    if calibration:
        lookup={(r['checkpoint']['treatment'],r['checkpoint']['seed']):{'mse':list(r['per_reference_deck_mse'].values())}
                for r in calibration if r['checkpoint']['endpoint']=='final'}
        effects('common_reference_value',lookup,['mse'],'fixed reference deck pairs; off-policy sampled targets',10000,19)
    replications=[]
    for domain,metric,effect in sorted({(c['domain'],c['metric'],c['effect']) for c in contrasts}):
        rows=[c for c in contrasts if (c['domain'],c['metric'],c['effect'])==(domain,metric,effect)]
        values=[c['difference'] for c in rows]; n=len(values); mean=statistics.mean(values)
        interval=None
        if n==3:
            radius=4.302652729911275*statistics.stdev(values)/np.sqrt(3)
            interval=[float(mean-radius),float(mean+radius)]
        replications.append({'domain':domain,'metric':metric,'effect':effect,'training_seeds':n,
            'seed_ids':[r['training_seed'] for r in rows],'seed_effects':values,'mean':mean,'t95':interval,
            'qualification':'Exploratory n=3; normal seed-effect assumption, unadjusted multiplicity; separate from conditional deck/position intervals'})
    payload={'campaign_status':status,'manifest_sha256':config['shared_manifest_sha256'],'runs':records,
             'game_matchups_completed':len(games),'planned_final_matchups':36,'completed_final_games':sum(g['completed'] for g in games),
             'planned_final_games':18432,'per_seed_factorial_contrasts':contrasts,'training_seed_effects':replications,
             'not_pooled_across_opponents':True,'primary_endpoint':TARGET,'reserved_accessed':False}
    atomic(output/'factorial-comparison.json',payload)
    columns=['domain','metric','effect','training_seed','difference','conditional95','pairs','unit']
    with (output/'factorial-comparison.csv').open('w',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=columns);writer.writeheader()
        for row in contrasts:writer.writerow({k:row[k] for k in columns})
    atomic(output/'learning-diagnostics.json',{'runs':records,'records':series,
           'value_loss_warning':'GAE-return target definition varies with lambda; loss/explained variance are not a common-ground-truth critic ranking'})
    lines=['# Campaign 4A — GAE × Critic Learning',f'\nStatus: **{status}**. No early stopping or best-checkpoint selection.',
           '\n| Run | State | Transitions | Completed games | PPO steps | Extra value steps | Extra seconds |',
           '| --- | --- | --- | --- | --- | --- | --- |']
    for r in records:lines.append(f"| {r['id']} | {r['status']} | {r['env_steps']} | {r['completed_games']} | {r['PPO_steps']} | {r['extra_critic_steps']} | {r['extra_critic_seconds']:.2f} |")
    lines+=['\n## Official playing strength',f"\nCompleted {sum(g['completed'] for g in games)}/18432 final games; opponents remain separate."]
    if not games: lines+=['\nNo final game results were supplied.']
    else:
        lines+=['\n| Run | Opponent | W/D/L | Score | NO_PROGRESS | Mean plies |','| --- | --- | --- | --- | --- | --- |']
        for g in games: lines.append(f"| {g['checkpoint']['id']} | {g['opponent']} | {g['wins']}/{g['draws']}/{g['losses']} | {g['score']:.4f} | {g['terminal_reason_counts']['NO_PROGRESS']} | {g['mean_plies']:.2f} |")
    primary_endpoint = next((r for r in replications if r['domain']=='games:intel_gae095_seed6011'
                             and r['metric']=='score' and r['effect']=='extra_at_095'), None)
    if primary_endpoint and primary_endpoint['training_seeds'] == len(SEEDS):
        lines.append(f"\nPrimary A1−A0 score effect against frozen Intel GAE095 seed6011: "
                     f"{primary_endpoint['mean']:+.4f}. Seed effects: {primary_endpoint['seed_effects']}.")
    else:
        lines.append('\nPrimary A1−A0 score requires all three matched training seeds against frozen Intel GAE095 seed6011.')
    lines+=['\n## Factorial effects across training seeds',
            '\nIntervals below concern three training replications. Per-checkpoint deck/position intervals are in factorial-comparison.json. Positive score/win effects are improvements; positive NO_PROGRESS/loss/MSE effects are increases.',
            '\n| Domain | Metric | Effect | Seed effects | Mean | Exploratory seed t95 |','| --- | --- | --- | --- | --- | --- |']
    for r in replications: lines.append(f"| {r['domain']} | {r['metric']} | {r['effect']} | {r['seed_effects']} | {r['mean']:.6f} | {r['t95']} |")
    lines+=['\n## Research questions and limits',
        '\n1. Lambda .80 vs .95: see lambda_without_extra and lambda_with_extra separately. Without completed games, playing-strength direction is pending.',
        '\n2. Extra Critic: see extra_at_095 and extra_at_080. The intervention updates only the existing linear value head; it does not test a larger critic or representation learning.',
        '\n3. Reliance on critic: interaction = (A3−A2)−(A1−A0). Positive game-strength interaction is compatible with greater benefit at lower lambda, not mechanistic proof.',
        '\n4. Common-value calibration: identical fixed public states and reference-policy sampled terminal-return targets; off-policy for new models. Correlation with strength is descriptive, not causal proof.',
        '\n5. Winning conversion: compare win-rate and NO_PROGRESS factorial effects alongside score, and tactical win/defense quality; lower value loss alone is insufficient.',
        '\n6. Compute justification: per-run extra optimizer steps/seconds are explicit above; training_seconds includes extra phase, with validation separated. Compare gains against these costs, not only optimizer throughput.',
        '\nThis 2×2 experiment compares .95 with .80; it does not contain a new lambda1 arm and cannot by itself explain every earlier lambda1→.95 improvement. Three seeds and unadjusted multiple comparisons limit inference. Truncated games count as transitions but never become fabricated terminal targets. No reserved confirmation positions were used.']
    (output/'research-report.md').write_text('\n'.join(lines)+'\n')
    (output/'critic-calibration.md').write_text('# Common terminal-return calibration\n\n'+
        ('Completed; see calibration-results.json and calibration-reference.json.\n' if calibration else 'No common-reference calibration results were supplied.\n')+
        '\nTraining GAE targets and explained variance vary by lambda and must be labeled separately.\n'+
        'The common reference corpus uses one fixed GAE095 policy against Baseline4023, both seats, up to eight public states/game. Every model predicts the identical sampled terminal returns on identical states. These are noisy off-policy reference-policy outcomes, not exact V_pi labels. Uncertainty averages seats per reference deck; source states from one game are not independent trials.\n')
    primary=[r for r in replications if r['domain']=='games:m1_exp2_baseline_4023' and r['metric']=='win_rate']
    supported=lambda effect:any(r['effect']==effect and r['training_seeds']==3 and min(r['seed_effects'])>0 and r['t95'][0]>0 for r in primary)
    if not primary: recommendation='Await official games; no architecture decision from training loss or tactical diagnostics alone.'
    elif supported('interaction'): recommendation='Explore bootstrap reliability and critic targets: a positive exploratory interaction is present; replicate before architecture changes.'
    elif supported('extra_at_095') and supported('extra_at_080'): recommendation='Explore value-learning training/architecture, with replication and compute controls; head-only extra learning improved conversion at both lambdas.'
    elif supported('lambda_without_extra') and supported('lambda_with_extra'): recommendation='Prioritize advantage estimation and variance reduction; lambda .80 improved conversion with and without extra head training in this exploratory cohort.'
    else: recommendation='No consistent positive conversion evidence by the preregistered exploratory criterion. Reconsider representation, opponents or search; absence of evidence for this linear-head intervention does not refute richer critic learning.'
    (output/'next-decision.md').write_text('# Conditional next research decision\n\n'+recommendation+'\n\n'+
        'Criterion: all three historical-opponent seed win-rate effects positive and exploratory n=3 t95 above zero. This is an analysis rule, not a treatment/checkpoint selector. Consult score, losses, NO_PROGRESS, tactical diagnostics, other opponents and actual compute cost before investing.\n')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(2,2,figsize=(12,8))
    for name,logs in series.items():
        if not logs:continue
        for ax,key in zip(axes.flat,['value_loss','advantage_variance','entropy','approx_kl']):
            usable=[r for r in logs if r.get(key) is not None]
            if usable:ax.plot([r['env_steps'] for r in usable],[r[key] for r in usable],label=name,alpha=.65,linewidth=.8)
            ax.set_title(key+(' (lambda-dependent targets)' if key=='value_loss' else ''));ax.set_xlabel('environment transitions')
    if axes[0,0].lines:
        axes[0,0].legend(fontsize=5,ncol=2)
    fig.tight_layout()
    fig.savefig(output/'learning-curves.png',dpi=150)
    plt.close(fig)


def main():
    from .campaign import read
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--campaign', type=Path, required=True)
    parser.add_argument('--games-dir', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not (args.campaign/'config.json').is_file():
        parser.error("--campaign must contain config.json")
    if args.games_dir is not None and not args.games_dir.is_dir():
        parser.error("--games-dir must exist")
    args.output.mkdir(parents=True, exist_ok=False)
    config = read(args.campaign/'config.json')
    status = read(args.campaign/'status.json', {})
    produce(args.campaign, config, status.get('state', 'existing_results'), output=args.output, games_dir=args.games_dir)


if __name__ == '__main__':
    main()
