var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function to_number(value) {
        return value === '' ? null : +value;
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src/App.svelte generated by Svelte v3.44.3 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[18] = list[i];
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[21] = list[i];
    	child_ctx[22] = list;
    	child_ctx[23] = i;
    	return child_ctx;
    }

    // (118:4) {#each volumes as volume, i}
    function create_each_block_1(ctx) {
    	let li;
    	let div0;
    	let t0_value = (/*i*/ ctx[23] === 0 ? '基音' : `第${/*i*/ ctx[23]}倍音`) + "";
    	let t0;
    	let t1;
    	let div1;
    	let input;
    	let t2;
    	let span;
    	let t3_value = /*volume*/ ctx[21] + "";
    	let t3;
    	let t4;
    	let mounted;
    	let dispose;

    	function input_change_input_handler() {
    		/*input_change_input_handler*/ ctx[8].call(input, /*each_value_1*/ ctx[22], /*i*/ ctx[23]);
    	}

    	return {
    		c() {
    			li = element("li");
    			div0 = element("div");
    			t0 = text(t0_value);
    			t1 = space();
    			div1 = element("div");
    			input = element("input");
    			t2 = space();
    			span = element("span");
    			t3 = text(t3_value);
    			t4 = space();
    			attr(div0, "class", "w-4/12 pr-3 text-gray-700 text-sm text-right border-box");
    			attr(input, "class", "w-48");
    			attr(input, "type", "range");
    			attr(input, "min", "0");
    			attr(input, "max", "1");
    			attr(input, "step", "0.01");
    			attr(span, "class", "inline-block ml-1");
    			attr(div1, "class", "w-8/12 text-left");
    			attr(li, "class", "flex my-1");
    		},
    		m(target, anchor) {
    			insert(target, li, anchor);
    			append(li, div0);
    			append(div0, t0);
    			append(li, t1);
    			append(li, div1);
    			append(div1, input);
    			set_input_value(input, /*volume*/ ctx[21]);
    			append(div1, t2);
    			append(div1, span);
    			append(span, t3);
    			append(li, t4);

    			if (!mounted) {
    				dispose = [
    					listen(input, "change", input_change_input_handler),
    					listen(input, "input", input_change_input_handler),
    					listen(input, "change", /*generateWave*/ ctx[3])
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty & /*volumes*/ 1) {
    				set_input_value(input, /*volume*/ ctx[21]);
    			}

    			if (dirty & /*volumes*/ 1 && t3_value !== (t3_value = /*volume*/ ctx[21] + "")) set_data(t3, t3_value);
    		},
    		d(detaching) {
    			if (detaching) detach(li);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    // (138:6) {#each SAMPLES as sample}
    function create_each_block(ctx) {
    	let button;
    	let t0_value = /*sample*/ ctx[18].label + "";
    	let t0;
    	let t1;
    	let mounted;
    	let dispose;

    	function click_handler() {
    		return /*click_handler*/ ctx[10](/*sample*/ ctx[18]);
    	}

    	return {
    		c() {
    			button = element("button");
    			t0 = text(t0_value);
    			t1 = space();
    			attr(button, "type", "button");
    			attr(button, "class", "px-2 py-1 rounded-sm bg-gray-200 text-xs font-bold hover:bg-gray-300");
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);
    			append(button, t0);
    			append(button, t1);

    			if (!mounted) {
    				dispose = listen(button, "click", click_handler);
    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div4;
    	let div0;
    	let button0;
    	let t1;
    	let button1;
    	let t3;
    	let button2;
    	let t5;
    	let ul;
    	let t6;
    	let div1;
    	let canvas_1;
    	let t7;
    	let div3;
    	let span;
    	let t9;
    	let div2;
    	let mounted;
    	let dispose;
    	let each_value_1 = /*volumes*/ ctx[0];
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	let each_value = /*SAMPLES*/ ctx[2];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			div4 = element("div");
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "Play";
    			t1 = space();
    			button1 = element("button");
    			button1.textContent = "Stop";
    			t3 = space();
    			button2 = element("button");
    			button2.textContent = "Reset";
    			t5 = space();
    			ul = element("ul");

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t6 = space();
    			div1 = element("div");
    			canvas_1 = element("canvas");
    			t7 = space();
    			div3 = element("div");
    			span = element("span");
    			span.textContent = "サンプルデータ";
    			t9 = space();
    			div2 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			attr(button0, "class", "inline-block mx-3 px-5 py-1 border-2 border-lime-700 rounded-md hover:bg-lime-100");
    			attr(button0, "type", "button");
    			attr(button1, "class", "inline-block mx-3 px-5 py-1 border-2 border-rose-700 rounded-md hover:bg-rose-100");
    			attr(button1, "type", "button");
    			attr(button2, "class", "inline-block mx-3 px-5 py-1 border-2 border-gray-500 rounded-md hover:bg-gray-100");
    			attr(button2, "type", "button");
    			attr(ul, "class", "list-none mt-10 mb-3");
    			attr(canvas_1, "width", WIDTH);
    			attr(canvas_1, "height", HEIGHT);
    			attr(div1, "class", "mt-10");
    			attr(div2, "class", "flex flex-wrap gap-1 mt-1");
    			attr(div3, "class", "mt-10 text-sm text-left");
    			attr(div4, "class", "w-[480px] m-20 text-gray-900 text-center");
    		},
    		m(target, anchor) {
    			insert(target, div4, anchor);
    			append(div4, div0);
    			append(div0, button0);
    			append(div0, t1);
    			append(div0, button1);
    			append(div0, t3);
    			append(div0, button2);
    			append(div4, t5);
    			append(div4, ul);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(ul, null);
    			}

    			append(div4, t6);
    			append(div4, div1);
    			append(div1, canvas_1);
    			/*canvas_1_binding*/ ctx[9](canvas_1);
    			append(div4, t7);
    			append(div4, div3);
    			append(div3, span);
    			append(div3, t9);
    			append(div3, div2);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div2, null);
    			}

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*play*/ ctx[4]),
    					listen(button1, "click", /*stop*/ ctx[5]),
    					listen(button2, "click", /*reset*/ ctx[6])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*volumes, generateWave*/ 9) {
    				each_value_1 = /*volumes*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_1(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(ul, null);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_1.length;
    			}

    			if (dirty & /*applyPreset, SAMPLES*/ 132) {
    				each_value = /*SAMPLES*/ ctx[2];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div2, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div4);
    			destroy_each(each_blocks_1, detaching);
    			/*canvas_1_binding*/ ctx[9](null);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    const FREQ = 440;
    const SR = 48000;

    //波形の図
    const WIDTH = 480;

    const HEIGHT = 120;

    function instance($$self, $$props, $$invalidate) {
    	const volumes = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    	const SAMPLES = [
    		{
    			label: 'バイオリン',
    			volumes: [1, 0.45, 0.12, 0.32, 0.19, 0.19, 0.67, 0.22, 0, 0]
    		},
    		{
    			label: 'クラリネット',
    			volumes: [0.5, 0, 1, 0.3, 0, 0.07, 0, 0, 0, 0]
    		},
    		{
    			label: 'サイン波',
    			volumes: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    		}
    	];

    	const audioContext = new AudioContext();
    	const buffer = audioContext.createBuffer(2, SR, SR);
    	const bufferL = buffer.getChannelData(0);
    	const bufferR = buffer.getChannelData(1);
    	let sound = null;

    	const generateWave = () => {
    		if (sound !== null) {
    			sound.stop();
    		}

    		const amp = 1.0 / volumes.reduce((a, b) => a + b, 0);

    		for (let i = 0; i < SR; i += 1) {
    			let value = volumes.reduce(
    				(sum, volume, j) => {
    					return sum + Math.sin(i / SR * (FREQ * (j + 1) * 2 * Math.PI)) * volume * amp;
    				},
    				0
    			);

    			bufferL[i] = value;
    			bufferR[i] = value;
    		}

    		draw();
    	};

    	let canvas;
    	let canvasCtx = null;

    	const draw = () => {
    		if (canvasCtx === null) return;
    		canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);
    		canvasCtx.fillStyle = '#040720';
    		canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    		canvasCtx.fillStyle = '#00ffff';

    		for (let i = 0; i < WIDTH; i += 1) {
    			canvasCtx.fillRect(i, bufferL[i] * HEIGHT / 4 + HEIGHT / 2, 1, 1);
    		}
    	};

    	onMount(() => {
    		canvasCtx = canvas.getContext('2d');
    		generateWave();
    		draw();
    	});

    	const play = () => {
    		sound = audioContext.createBufferSource();
    		sound.buffer = buffer;
    		sound.loop = true;
    		sound.connect(audioContext.destination);
    		sound.start();
    	};

    	const stop = () => {
    		if (sound === null) return;
    		sound.stop();
    	};

    	const reset = () => {
    		if (sound !== null) {
    			sound.stop();
    		}

    		$$invalidate(0, volumes[0] = 1, volumes);

    		for (let i = 1; i < 10; i += 1) {
    			$$invalidate(0, volumes[i] = 0, volumes);
    		}

    		generateWave();
    	};

    	const applyPreset = value => {
    		value.forEach((v, i) => {
    			$$invalidate(0, volumes[i] = v, volumes);
    		});

    		generateWave();
    	};

    	function input_change_input_handler(each_value_1, i) {
    		each_value_1[i] = to_number(this.value);
    		$$invalidate(0, volumes);
    	}

    	function canvas_1_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			canvas = $$value;
    			$$invalidate(1, canvas);
    		});
    	}

    	const click_handler = sample => applyPreset(sample.volumes);

    	return [
    		volumes,
    		canvas,
    		SAMPLES,
    		generateWave,
    		play,
    		stop,
    		reset,
    		applyPreset,
    		input_change_input_handler,
    		canvas_1_binding,
    		click_handler
    	];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
      target: document.querySelector('#app'),
      props: {}
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
