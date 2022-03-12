/*!
 * Jodit Editor (https://xdsoft.net/jodit/)
 * Released under MIT see LICENSE.txt in the project root for license information.
 * Copyright (c) 2013-2022 Valeriy Chupurnov. All rights reserved. https://xdsoft.net
 */

/**
 * [[include:plugins/search/README.md]]
 * @packageDocumentation
 * @module plugins/search
 */

import type {
	ISelectionRange,
	IJodit,
	Nullable,
	IPlugin,
	IDictionary,
	CanUndef
} from 'jodit/types';
import { Dom, LazyWalker } from 'jodit/core/dom';
import { Plugin } from 'jodit/core/plugin';
import { autobind, watch } from 'jodit/core/decorators';
import { SentenceFinder } from 'jodit/plugins/search/helpers';
import { UISearch } from 'jodit/plugins/search/ui/search';

import './config';

/**
 * Search plugin. it is used for custom search in text
 * ![search](https://user-images.githubusercontent.com/794318/34545433-cd0a9220-f10e-11e7-8d26-7e22f66e266d.gif)
 *
 * @example
 * ```typescript
 * var jodit = new Jodit('#editor', {
 *  useSearch: false
 * });
 * // or
 * var jodit = new Jodit('#editor', {
 *  disablePlugins: 'search'
 * });
 * ```
 */
export class search extends Plugin {
	override buttons: IPlugin['buttons'] = [
		{
			name: 'find',
			group: 'search'
		}
	];

	private ui: UISearch = new UISearch(this.j);

	@watch('ui:needUpdateCounters')
	private async updateCounters(): Promise<void> {
		if (!this.ui.isOpened) {
			return;
		}

		this.ui.count = await this.calcCounts(this.ui.queryInput.value);
	}

	@watch('ui:pressReplaceButton')
	protected onPressReplaceButton(): void {
		this.findAndReplace(this.ui.queryInput.value);
		this.updateCounters();
	}

	private tryScrollToElement(startContainer: Node): void {
		// find scrollable element
		let parentBox: HTMLElement | false = Dom.closest(
			startContainer,
			Dom.isElement,
			this.j.editor
		) as HTMLElement | false;

		if (!parentBox) {
			parentBox = Dom.prev(
				startContainer,
				Dom.isElement,
				this.j.editor
			) as HTMLElement | false;
		}

		parentBox && parentBox !== this.j.editor && parentBox.scrollIntoView();
	}

	protected async calcCounts(query: string): Promise<number> {
		if (this.walkerCount) {
			this.walkerCount.break();
		}

		this.walkerCount = new LazyWalker(this.j.async, {
			timeout: 1
		});

		const result = await this.find(this.walkerCount, query);
		return result.length;
	}

	@autobind
	async findAndReplace(query: string): Promise<boolean> {
		if (this.walker) {
			this.walker.break();
		}

		this.walker = new LazyWalker(this.j.async, {
			timeout: this.j.defaultTimeout
		});

		const range = this.j.s.range,
			bounds = await this.find(this.walker, query);

		let currentIndex = bounds.findIndex(
			bound =>
				bound.startContainer === range.startContainer &&
				bound.startOffset === range.startOffset &&
				bound.endContainer === range.startContainer &&
				bound.endOffset === range.endOffset
		);

		if (currentIndex === -1) {
			currentIndex = 0;
		}

		const bound = bounds[currentIndex];

		if (bound && bound.startContainer && bound.endContainer) {
			const rng = this.j.ed.createRange();

			try {
				if (bound && bound.startContainer && bound.endContainer) {
					rng.setStart(
						bound.startContainer,
						bound.startOffset as number
					);

					rng.setEnd(bound.endContainer, bound.endOffset as number);
					rng.deleteContents();

					const textNode = this.j.createInside.text(
						this.ui.replaceInput.value
					);

					rng.insertNode(textNode);
					this.j.s.select(textNode);
					this.tryScrollToElement(textNode);
				}
			} catch {}

			return true;
		}

		return false;
	}

	@autobind
	async findAndSelect(query: string, next: boolean): Promise<boolean> {
		if (this.walker) {
			this.walker.break();
		}

		this.walker = new LazyWalker(this.j.async, {
			timeout: this.j.defaultTimeout
		});

		const range = this.j.s.range,
			bounds = await this.find(this.walker, query);

		if (!bounds.length) {
			return false;
		}

		let currentIndex = bounds.findIndex(
			bound =>
				bound.startContainer === range.startContainer &&
				bound.startOffset === range.startOffset &&
				bound.endContainer === range.startContainer &&
				bound.endOffset === range.endOffset
		);

		if (currentIndex === -1) {
			currentIndex = 0;
		} else {
			if (next) {
				currentIndex =
					currentIndex === bounds.length - 1 ? 0 : currentIndex + 1;
			} else {
				currentIndex =
					currentIndex === 0 ? bounds.length - 1 : currentIndex - 1;
			}
		}

		this.ui.currentIndex = currentIndex + 1;

		const bound = bounds[currentIndex];

		if (bound && bound.startContainer && bound.endContainer) {
			const rng = this.j.ed.createRange();

			try {
				rng.setStart(bound.startContainer, bound.startOffset as number);
				rng.setEnd(bound.endContainer, bound.endOffset as number);
				this.j.s.selectRange(rng);
			} catch (e) {}

			this.tryScrollToElement(bound.startContainer);

			await this.updateCounters();

			return true;
		}

		return false;
	}

	walker: Nullable<LazyWalker> = null;
	walkerCount: Nullable<LazyWalker> = null;

	private cache: IDictionary<CanUndef<Promise<ISelectionRange[]>>> = {};

	@autobind
	async find(walker: LazyWalker, query: string): Promise<ISelectionRange[]> {
		if (!query.length) {
			return [];
		}

		if (this.cache[query]) {
			return this.cache[query] as Promise<ISelectionRange[]>;
		}

		const sentence = new SentenceFinder();

		this.cache[query] = this.j.async.promise(resolve => {
			walker
				.on('break', (): void => {
					resolve([]);
				})
				.on('visit', (elm: Node): boolean => {
					if (Dom.isText(elm)) {
						sentence.add(elm);
					}
					return false;
				})
				.on('end', (): void => {
					resolve(sentence.ranges(query) ?? []);
				})
				.setWork(this.j.editor);
		});

		return this.cache[query] as Promise<ISelectionRange[]>;
	}

	/** @override */
	afterInit(editor: IJodit): void {
		if (editor.o.useSearch) {
			const self: search = this;

			editor.e
				.on('beforeSetMode.search', () => {
					this.ui.close();
				})
				.on('change.search', () => {
					this.cache = {};
				})
				.on('keydown.search mousedown.search', () => {
					if (this.ui.selInfo) {
						editor.s.removeMarkers();
						this.ui.selInfo = null;
					}

					if (this.ui.isOpened) {
						// this.current = this.j.s.current();
						this.updateCounters();
					}
				})
				.on('searchNext.search searchPrevious.search', () => {
					if (!this.ui.isOpened) {
						return this.ui.open();
					}

					return self
						.findAndSelect(
							self.ui.queryInput.value,
							editor.e.current === 'searchNext'
						)
						.catch(() => {});
				})
				.on('search.search', (value: string, next: boolean = true) => {
					editor.execCommand('search', value, next);
				});

			editor
				.registerCommand('search', {
					exec: (
						command: string,
						value?: string,
						next: boolean = true
					) => {
						self.findAndSelect(value || '', next).catch(() => {});

						return false;
					}
				})
				.registerCommand('openSearchDialog', {
					exec: () => {
						self.ui.open();
						return false;
					},
					hotkeys: ['ctrl+f', 'cmd+f']
				})
				.registerCommand('openReplaceDialog', {
					exec: () => {
						if (!editor.o.readonly) {
							self.ui.open(true);
						}
						return false;
					},
					hotkeys: ['ctrl+h', 'cmd+h']
				});
		}
	}

	/** @override */
	beforeDestruct(jodit: IJodit): void {
		this.ui.destruct();
		jodit.e.off('.search');
	}
}
