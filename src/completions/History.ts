import * as Completions from "../completions"
import * as config from "../config"
import { browserBg } from "../lib/webext"

class HistoryCompletionOption extends Completions.CompletionOptionHTML
    implements Completions.CompletionOptionFuse {
    public fuseKeys = []

    constructor(public value: string, page: browser.history.HistoryItem) {
        super()
        if (!page.title) {
            page.title = new URL(page.url).host
        }

        // Push properties we want to fuzmatch on
        this.fuseKeys.push(page.title, page.url) // weight by page.visitCount

        // Create HTMLElement
        // need to download favicon
        const favIconUrl = Completions.DEFAULT_FAVICON
        // const favIconUrl = tab.favIconUrl ? tab.favIconUrl : DEFAULT_FAVICON
        this.html = html`<tr class="HistoryCompletionOption option">
            <td class="prefix">${"".padEnd(2)}</td>
            <td></td>
            <td>${page.title}</td>
            <td><a class="url" target="_blank" href=${page.url}>${
            page.url
        }</a></td>
        </tr>`
    }
}

export class HistoryCompletionSource extends Completions.CompletionSourceFuse {
    public options: HistoryCompletionOption[]

    constructor(private _parent) {
        super(
            ["open ", "tabopen ", "winopen "],
            "HistoryCompletionSource",
            "History",
        )

        this._parent.appendChild(this.node)
    }

    public async filter(exstr: string) {
        this.lastExstr = exstr
        const [prefix, query] = this.splitOnPrefix(exstr)

        // Hide self and stop if prefixes don't match
        if (prefix) {
            // Show self if prefix and currently hidden
            if (this.state === "hidden") {
                this.state = "normal"
            }
        } else {
            this.state = "hidden"
            return
        }

        this.options = (await this.scoreOptions(query, 10)).map(
            page => new HistoryCompletionOption(page.url, page),
        )

        this.updateChain()
    }

    updateChain() {
        // Options are pre-trimmed to the right length.
        this.options.forEach(option => (option.state = "normal"))

        // Call concrete class
        this.updateDisplay()
    }

    onInput() {}

    private frecency(item: browser.history.HistoryItem) {
        // Doesn't actually care about recency yet.
        return item.visitCount * -1
    }

    private async scoreOptions(query: string, n: number) {
        const newtab = browser.runtime.getManifest()["chrome_url_overrides"]
            .newtab
        const newtaburl = browser.extension.getURL(newtab)
        if (!query) {
            return (await browserBg.topSites.get())
                .filter(page => page.url !== newtaburl)
                .slice(0, n)
        } else {
            // Search history, dedupe and sort by frecency
            let history = await browserBg.history.search({
                text: query,
                maxResults: Number(config.get("historyresults")),
                startTime: 0,
            })

            // Remove entries with duplicate URLs
            const dedupe = new Map()
            for (const page of history) {
                if (page.url !== newtaburl) {
                    if (dedupe.has(page.url)) {
                        if (
                            dedupe.get(page.url).title.length <
                            page.title.length
                        ) {
                            dedupe.set(page.url, page)
                        }
                    } else {
                        dedupe.set(page.url, page)
                    }
                }
            }
            history = [...dedupe.values()]

            history.sort((a, b) => this.frecency(a) - this.frecency(b))

            return history.slice(0, n)
        }
    }
}