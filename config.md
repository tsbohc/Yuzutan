# 🍋 Yuzutan intro

The core idea is to learn new vocab and how to write it at the same time, helping disambiguate things and improving recognition.

- 📙 **filters your mining deck** <br>and looks for Expressions and Sentences

- 📇 **generates fancy kanji cards** <br>for whatever it finds

- 🗃️ **sorts cards topologically** <br>first you'll see 羊, then 達, etc

- 🧭 **prompts you with *your* mined words** <br>randomly selected per reading + sentences

- ✒️ **lets you draw in Anki** <br>and shows conditional stroke diagram hints

- 🎯 **tells you if you messed up** <br>by checking for wrong stroke count/order/direction

By default, the addon is *purist-friendly*. Draw a kanji from memory, flip, compare on the back.

That said, there are weird fancy recognition-focused features, which try to speed up reviews, induce recall, and more.

Note that at this stage, the addon is not stable. Things might be introduced, changed, or removed without warning.

## 🔧 extra setup required!

The addon requires `ExpressionFurigana` or a similar field to have **split furigana**, such as `会[かい] 社[しゃ]`✔️. This won't work: `会社[かいしゃ]`❌.

Here's a short guide:

1. Install [backfill-anki-yomitan](https://github.com/Manhhao/backfill-anki-yomitan) Anki addon and set it up.

2. Download and import this [JmdictFurigana](https://gist.github.com/jpovixwm/46d52ad16ab16f3158dad245cf88d505/raw/01cc133d9b7b6ebcc08431f6d2d27f8c714401d2/jitendex-yomitan-20260709-JmdictFurigana.zip) into Yomitan, activate it.

3. Add the following **handlebar** into `Yomitan Settings` -> `Customize handlebars templates...`
   <details><summary>click me for handlebar code!</summary><pre><code>
   {{#*inline "jmdict-furigana-plain"}}
      {{~#regexReplace "<ruby>(.+?)<rt>(.+?)</rt></ruby>" " $1[$2]" "g"~}}
         {{~set "foundJmdictFurigana" false ~}}
         {{~#each definition.definitions~}}
            {{~#unless (get "foundJmdictFurigana")~}}
                  {{~#if (op "===" "jmdict-furigana" (property glossary 0 "content" "data" "content"))~}}
                     {{~set "foundJmdictFurigana" true ~}}
                     {{~>render-structured-content (property glossary 0 "content" "content") ~}}
                  {{~/if~}}
            {{~/unless~}}
         {{~/each~}}
         {{~#if (op "&&" (op "!" skipFallback) (op "!" (get "foundJmdictFurigana")))~}}
            {{~>furigana~}}
         {{~/if~}}
      {{~/regexReplace~}}
   {{/inline}}
   </code></pre></details>

4. in `Yomitan Settings` -> `Configure Anki flashcards...`, make sure the `ExpressionFurigana` field (or similar) is set to **{jmdict-furigana-plain}**

5. Make a **backup** of your Anki collection!!

6. Backfill all of your vocab cards.

Credits for the converted [JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) are in this [issue](https://github.com/yomidevs/yomitan/issues/2451).


## 🎨 interface

Addon's menu is under **Tools** -> **Yuzutan** in the Anki menu bar. Adjust the config, generate the deck from there. 

During reviews, all buttons can also be long-pressed for additional functionality:

- 🧹・🧽 undo last stroke; clear canvas
- 💡・🌧️ step through manual hint; toggle auto hint
- 🧭・📌 show stroke diagram; pin stroke diagram

On the back of the card, the buttons are replaced with score% and hint%, as well as icons for what was pressed on the front.

The score% should only be used to gauge if anything went wrong (e.g missing a stroke results in 0 score).

The hint% can be used to decide whether or not to fail the card if the kanji was completed correctly.

## ⚙️ config

## source_fields

Default values work for Lapis, Kiku, and other note types that use the same conventions. Note: the addon only supports working with one model!

- **expression** - word with **with furigana**
- **sentence** - context sentence **with furigana**

The **expression** field requires furigana to be split. Ideally, sentence furigana should be plain (brackets, no html tags).

## source_queries

These are normal card browser queries, with the exception of **limit=n**, which limits how many cards will be processed.

You're meant to adjust these based on which kanji are important to you. Here are some ideas:

- ***everything*** <br>`deck:mydeck`
- **everything but news** <br>`deck:mydeck -is:new`
- **10 next news** <br>`deck:mydeck is:new limit=10` 
- **many lapses** <br>`deck:mydeck prop:lapses>5`
- **low retrievability** <br>`deck:mydeck prop:r<0.5`

Test in the browser before generating the deck!

Queries are ran sequentially, and the created kanji cards are sorted with topokanji ordering.

## target_deck

The name of the deck where the kanji cards will be generated. If the deck doesn't exist, it will be created automatically.

## reviews

### hint_first_stroke_start

Whether or not to show a dot where the first stroke starts on the front side of the card. `true` or `false`.

### hint_noise_manual_step

The hint button displays random scattered points (noise) of the kanji. The default value `0.2` adds 20% per press.

### hint_noise_auto_grace_period

How many seconds before autohint will show any noise and how long to wait before displaying additional noise after the pen is lifted.

Autohint does not progress when the pen is down.

### hint_noise_auto_timeframe

How many seconds auto hint will take to display all of the noise (excluding the initial grace period).

### stroke_order_gradient

Stroke colouring for diagrams and user input on the back side of the card.

- `"color"` - color gradient, red to pink
- `"mono"` - monochrome, faint gray to black

### stroke_line_width

Width in px for rendering kanji strokes (stroke diagram, user drawing). 

### stroke_smoothing_passes

Makes drawn lines smoother. Set to 0 if you run into issues.

### text_kanji_mask

Determines what the kanji on the front side of the card will be replaced with.

If multiple characters are specified, one will be picked based on stroke count. The last character always maps to 20+ strokes.

- `"〇"` - always replace the target kanji with marumaru
- `"▢▨▩"` - `▢` for 1-7 strokes ... `▩` for 15-20+
- `"░▒▓█"` - `░` for 1-5 strokes ... `█` for 16-20+

## _experimental

What this does will depend on what I'm experimenting with at the moment. If you're reading this, keep it at `false`.

## window

- Resizes and centers the Anki window
- `aspect` overrides `height` unless set to `""`

Useful when mapping a graphic tablet to a small portion of the screen (I have an ultrawide and use OpenTabletDriver).

<hr>

## disclaimers

This is an opinionated addon. I made it primarily *for myself*. As such, I cannot promise adding requested features. I do want you to have a good experience though.

Also, I can do some light coding, but I'm not a developer. I did talk to a clanker to help me figure out how to implement some stuff. Most code is either generic or human written, for better or for worse.