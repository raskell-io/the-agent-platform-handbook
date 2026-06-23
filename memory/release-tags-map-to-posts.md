---
name: release-tags-map-to-posts
description: Release tags follow post-NN and map one-to-one to blog posts
type: fact
---

Release tags in this repo follow the `post-NN` convention and map
one-to-one to the published posts in the series. A tag is the frozen state
of the code that its post discusses, so an existing `post-NN` is never
retagged or moved, even to fold in a later fix. When new work lands, cut
the next number rather than rewriting an old tag. Confirm against `git tag`
before tagging.
