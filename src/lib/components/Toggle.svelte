<script lang="ts">
	// Radar-style labelled switch (the orange "最小/最大比例" toggle): text label
	// on the left, pill track with a sliding knob on the right.
	let {
		label,
		checked = $bindable(false)
	}: {
		label: string;
		checked?: boolean;
	} = $props();
</script>

<label class="toggle">
	<span class="t-lbl">{label}</span>
	<input type="checkbox" bind:checked />
	<span class="track" aria-hidden="true"><span class="knob"></span></span>
</label>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: 0.78rem;
		color: var(--text-dim);
		user-select: none;
		white-space: nowrap;
		position: relative;
	}
	input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.track {
		width: 30px;
		height: 16px;
		border-radius: 999px;
		background: var(--border-strong);
		position: relative;
		flex: none;
		transition: background 0.15s;
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #fff;
		transition: left 0.15s;
	}
	input:checked ~ .track {
		background: var(--accent);
	}
	input:checked ~ .track .knob {
		left: 16px;
	}
	input:focus-visible ~ .track {
		box-shadow: var(--ring);
	}
</style>
