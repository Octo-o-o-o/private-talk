# Licensing Notes

This document explains the licensing choice for Private Talk.

## Recommended Setup

- Code license: Apache License 2.0
- Attribution file: `NOTICE`
- Brand guidance: `docs/TRADEMARKS.md`

## Why Apache-2.0 Fits This Project

Private Talk is intended to be:

- free to use
- easy to fork and improve
- safe for individuals and companies to adopt
- still clearly attributable to the upstream project

Apache-2.0 is a good fit because it:

- allows free use, modification, distribution, and commercial use
- includes an express patent grant
- requires preservation of license and notice text
- does not grant trademark rights by default
- works well with a separate `NOTICE` file for attribution

## Why Not Plain MIT

MIT is simple and permissive, but it is weaker for this specific goal:

- it does not have a built-in `NOTICE` mechanism
- it is less structured for carrying upstream attribution beyond the license itself
- it does not give the same explicit patent grant as Apache-2.0

If the goal is "fully free to use" plus "keep a small amount of upstream attribution and ClawButler discoverability", Apache-2.0 is usually the better balance.

## Why Not AGPL

AGPL is useful when the main goal is forcing server-side modifications to be published back.

That is not the main goal here.

For Private Talk, AGPL would add more friction for adoption while still not solving the real branding goal: it does not guarantee that forks will keep promoting ClawButler in product UI or marketing copy.

## What The License Can Realistically Enforce

With Apache-2.0 plus `NOTICE`, you can reasonably require downstream redistributors to preserve:

- the license text
- copyright notices
- attribution notices included in `NOTICE`

With Apache-2.0 plus `docs/TRADEMARKS.md`, you can also keep clearer control over:

- the `Private Talk` name
- the `ClawButler` name
- project logos and brand assets

## What The License Should Not Try To Enforce

A standard open-source license should not be used to force downstream users to:

- advertise ClawButler inside product UI
- keep sales or marketing copy
- display promotional text in places that are unrelated to legal notices

That is why this repository uses a combination of:

- permissive code licensing
- attribution notices
- separate trademark guidance
- README-level project positioning

## Practical Result

This setup gives you a clear and standard open-source story:

- users can use the project for free
- companies can adopt it without unusual license friction
- upstream attribution stays attached
- ClawButler can be linked and discovered in a normal, legitimate way
- forks cannot safely present themselves as the original project without renaming or clearer attribution
