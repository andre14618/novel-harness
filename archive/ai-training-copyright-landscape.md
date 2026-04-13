# AI Training & Copyright: Legal Landscape (as of April 2026)

Compiled April 2026. No court has issued a definitive ruling on small-scale personal fine-tuning. The landscape is evolving rapidly.

## Key Court Decisions (2025)

### Thomson Reuters v. Ross Intelligence (Feb 2025)
**First ruling on AI training fair use. NOT fair use.**

Ross Intelligence trained an AI legal search tool on Thomson Reuters' Westlaw headnotes after Thomson Reuters refused to license the content. The court granted partial summary judgment to Thomson Reuters.

- **Transformativeness**: The court found Ross's use was NOT transformative because it created a tool that served the same function as Westlaw — a direct competitor.
- **Market harm**: The "single most important element" — Ross's product was a market substitute for Westlaw and undercut its potential licensing market for AI training data.
- **Significance**: Established that building a competing product from copyrighted training data is likely infringing. The competitive relationship between the original work and the AI output was decisive.

### Kadrey v. Meta Platforms (June 2025)
**Training LLMs on copyrighted books — broadly unfavorable for AI companies.**

Authors sued Meta over training Llama on copyrighted books, including books obtained from shadow libraries (pirate sites).

- Judge Chhabria broadly stated that "in most cases," training LLMs on copyrighted works without permission is **likely infringing and not fair use**.
- This is one of the most author-friendly rulings to date.

### Bartz v. Anthropic (June 2025)
**Split decision — training was fair use, but acquisition of pirated books was not.**

- The court found that the use of copyrighted works to train an AI model was **highly transformative and fair use** on the facts before it.
- However, Anthropic's acquisition of millions of pirated books from shadow libraries was NOT fair use.
- **Settled for up to $1.5 billion** based primarily on the acquisition issue.
- **Key distinction**: How you obtain the training data matters as much as how you use it.

## Copyright Office Position (May 2025)

The U.S. Copyright Office released its report on Generative AI Training, concluding:

> "It is not possible to prejudge litigation outcomes. Some uses of copyrighted works for generative AI training will qualify as fair use, and some will not."

The report did not propose new legislation or bright-line rules. It acknowledged the complexity and left resolution to the courts.

## NYT v. OpenAI (Ongoing)

- **March 2025**: Judge rejected OpenAI's motion to dismiss, allowing the case to proceed.
- **January 2026**: Court ordered OpenAI to produce 20 million ChatGPT conversation logs as discovery evidence.
- **No trial date set** as of April 2026. Evidence gathering and depositions ongoing.
- OpenAI argues fair use; NYT argues systematic exploitation of its journalism.

## The Fair Use Framework (Applied to AI Training)

Courts evaluate four factors:

| Factor | Favors AI Company | Favors Rights Holder |
|--------|-------------------|---------------------|
| **Purpose & character** | Transformative use (output is fundamentally different from training data) | Commercial use; output competes with the original |
| **Nature of the work** | Factual works get less protection | Creative works (fiction, journalism) get more protection |
| **Amount used** | Small excerpts, not whole works | Entire works ingested |
| **Market effect** | No market substitute; different audience | Output competes with or replaces the original |

## Patterns Emerging from the Cases

1. **How you obtain the data matters** — pirated sources, shadow libraries, and scraping behind paywalls are clearly problematic (Bartz v. Anthropic).
2. **Whether the output competes** with the original is the strongest factor — a direct competitor kills fair use (Thomson Reuters v. Ross).
3. **Transformativeness can save you** — if the model produces something fundamentally different from the training data, courts lean toward fair use (Bartz training finding).
4. **Scale matters informally** — all lawsuits target companies training on massive corpora for commercial products. No cases against individuals or researchers using small samples.

## Application: Personal LoRA Fine-Tuning

No court has ruled on small-scale personal fine-tuning for style transfer. Here's how the factors would likely apply:

**Arguments for fair use:**
- Small sample (hundreds of paragraphs, not whole books)
- Highly transformative (output is original fiction, not reproduction of training content)
- Not a competing product (writing new novels, not reproducing the source author's work)
- No commercial distribution of training data or model weights
- Back-translation pipeline means the model learns stylistic patterns, not content

**Arguments against fair use:**
- Creative works (fiction) receive strong copyright protection
- Commercial use even if indirect (the novel is the product)
- The author's "style" has market value and the fine-tune appropriates it

**Practical risk assessment:** Extremely low for personal use. The lawsuits are all against companies (OpenAI, Meta, Anthropic, Stability AI) distributing commercial products trained on massive datasets. No precedent for or interest in pursuing individuals fine-tuning small models on limited samples. But legal uncertainty remains until courts rule on cases closer to this use pattern.

## Status of Major AI Copyright Cases (as of April 2026)

| Case | Status | Key Issue |
|------|--------|-----------|
| Thomson Reuters v. Ross | Decided (Feb 2025) — NOT fair use | Competing product trained on copyrighted data |
| Kadrey v. Meta | Decided (June 2025) — likely NOT fair use in most cases | LLM training on copyrighted books |
| Bartz v. Anthropic | Settled ($1.5B, June 2025) | Training fair use, pirated acquisition not |
| NYT v. OpenAI | Discovery phase, no trial date | Journalism used to train ChatGPT |
| Getty v. Stability AI | Active | Image generation from copyrighted photos |
| Authors Guild v. OpenAI | Active | Books used to train GPT models |
| Concord v. Anthropic | Active | Music lyrics in Claude outputs |

51+ total copyright lawsuits against AI companies as of October 2025. Most are in early stages. No additional fair use rulings expected before summer 2026.

## Sources

- [Three Key Decisions on AI Training and Copyrighted Content from 2025 (IPWatchdog)](https://ipwatchdog.com/2025/12/23/copyright-ai-collide-three-key-decisions-ai-training-copyrighted-content-2025/)
- [Fair Use and AI Training: Two Recent Decisions (Skadden)](https://www.skadden.com/insights/publications/2025/07/fair-use-and-ai-training)
- [Thomson Reuters v. Ross: First AI Fair Use Ruling (Davis Wright Tremaine)](https://www.dwt.com/blogs/artificial-intelligence-law-advisor/2025/02/reuters-ross-court-ruling-ai-copyright-fair-use)
- [Copyright Office Report on AI Training (Skadden)](https://www.skadden.com/insights/publications/2025/05/copyright-office-report)
- [AI Copyright Cases Update 2026 (Norton Rose Fulbright)](https://www.nortonrosefulbright.com/en/knowledge/publications/ce8eaa5f/ai-in-litigation-series-an-update-on-ai-copyright-cases-in-2026)
- [NYT v. OpenAI Goes Forward (NPR)](https://www.npr.org/2025/03/26/nx-s1-5288157/new-york-times-openai-copyright-case-goes-forward)
- [Status of All 51 Copyright Lawsuits v. AI (Oct 2025)](https://chatgptiseatingtheworld.com/2025/10/08/status-of-all-51-copyright-lawsuits-v-ai-oct-8-2025-no-more-decisions-on-fair-use-in-2025/)
- [Congress.gov: Generative AI and Copyright Law](https://www.congress.gov/crs-product/LSB10922)
- [Mid-Year Review: AI Copyright Case Developments 2025 (Copyright Alliance)](https://copyrightalliance.org/ai-copyright-case-developments-2025/)
