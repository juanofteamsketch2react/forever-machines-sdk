package net.forevermachines.demo

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ScrollView
import android.widget.TextView
import net.forevermachines.sdk.FMControl
import net.forevermachines.sdk.FMMachine
import net.forevermachines.sdk.FMSession
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

// the six places of the retreat, as on forevermachines.net/sleep: a machine each, its skin, its picture
data class Place(val id: String, val name: String, val place: String, val whenText: String, val sub: String, val view: String)

val PLACES = listOf(
    Place("slow-tide", "Slow Tide", "The beach", "after dark", "The sea at night, and a boat that is going nowhere.", "tide"),
    Place("night-choir", "Night Choir", "The sala", "late", "Five voices, one slow chord, five lanterns.", "choir"),
    Place("seven-bowls", "Seven Bowls", "The table", "evening sitting", "Metal bowls and a patient hand.", "bowls"),
    Place("lotus-pond", "Lotus Pond", "The pond", "past midnight", "Drops in key, crickets, one frog with opinions.", "pond"),
    Place("rain-window", "Rain Window", "The hut", "while it rains", "Rain on warm glass, tea going cold.", "rain"),
    Place("long-breath", "Long Breath", "The lookout", "first light", "In, and a bell, and slowly out.", "breath"),
)

// a skin's colours by role (machine.colors), with the sleep page's own skin for each place before the machine is up
class Skin(val vars: Map<String, String>) {
    fun c(role: String): Int = try { Color.parseColor(vars[role] ?: FALLBACK[role] ?: "#888888") } catch (_: Exception) { Color.GRAY }
    companion object {
        val FALLBACK = mapOf("page" to "#04141a", "page-ink" to "#cdeee6", "dev" to "#1d2a30", "head" to "#22323a", "line" to "#2f4650", "ink" to "#e6f2ef",
            "dim" to "#7fa3a0", "accent" to "#ff8fc0", "accent2" to "#5cf2c8", "track" to "#2a3d44", "field" to "#0c1a1e", "field-ink" to "#e6f2ef")
    }
}

class MainActivity : Activity() {
    private lateinit var fm: FMSession
    private var machine: FMMachine? = null
    private val main = Handler(Looper.getMainLooper())
    private val dp by lazy { resources.displayMetrics.density }
    private var current = PLACES[0]
    private var skin = Skin(emptyMap())
    private var skins: JSONObject = JSONObject()
    private var lamp = 0.45f
    private var level = 0f
    private var editing: String? = null
    private var ticks = 0
    private var finger: Pair<Float, Float>? = null
    private val dials = mutableMapOf<String, Dial>()
    private val texts = mutableMapOf<String, (FMControl) -> Unit>()

    private lateinit var root: FrameLayout
    private lateinit var lampOff: ImageView
    private lateinit var lampOn: ImageView
    private lateinit var scroller: ScrollView
    private lateinit var where: TextView
    private lateinit var title: TextView
    private lateinit var sub: TextView
    private lateinit var play: TextView
    private lateinit var wind: TextView
    private lateinit var tiles: List<FrameLayout>
    private lateinit var device: LinearLayout
    private lateinit var head: LinearLayout
    private lateinit var power: View
    private lateinit var devName: TextView
    private lateinit var meter: Meter
    private lateinit var picture: ImageView
    private lateinit var touchHint: TextView
    private lateinit var panel: LinearLayout
    private lateinit var machineTitle: TextView
    private lateinit var machineSub: TextView

    private fun bitmap(name: String): Bitmap? = try { assets.open("retreat/$name.webp").use { BitmapFactory.decodeStream(it) } } catch (_: Exception) { null }
    private fun px(v: Float) = (v * dp).toInt()
    private fun round(color: Int, r: Float, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color); cornerRadius = r * dp; if (stroke != null) setStroke(px(1f), stroke)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        fm = FMSession(this)
        skins = try { JSONObject(assets.open("retreat/sleep-skins.json").bufferedReader().readText()) } catch (_: Exception) { JSONObject() }

        // the place itself: the Blender still with its lanterns out, and lit over it as far as the music lets them
        lampOff = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        lampOn = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        val shade = View(this)

        where = TextView(this).apply { textSize = 12f; typeface = Typeface.MONOSPACE; letterSpacing = 0.2f }
        title = TextView(this).apply { textSize = 44f; typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); setShadowLayer(18f, 0f, 2f, Color.BLACK) }
        sub = TextView(this).apply { textSize = 18f; setTypeface(Typeface.SERIF, Typeface.ITALIC); setShadowLayer(12f, 0f, 1f, Color.BLACK) }
        play = TextView(this).apply { textSize = 17f; typeface = Typeface.DEFAULT_BOLD; setPadding(px(24f), px(12f), px(24f), px(12f)) }
        wind = TextView(this).apply { textSize = 15f; setPadding(px(18f), px(12f), px(18f), px(12f)) }
        play.setOnClickListener { if (fm.isPlaying) fm.stop() else fm.power(true); paint() }
        wind.setOnClickListener { fm.windDown(1.0); paint() }
        fm.onWind = { paint() }
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(play); addView(View(context), LinearLayout.LayoutParams(px(12f), 1)); addView(wind)
        }

        // the six places, all in view: two rows of three, each with its picture
        val grid = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val tl = mutableListOf<FrameLayout>()
        for (row in 0 until 2) {
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (col in 0 until 3) {
                val p = PLACES[row * 3 + col]
                val tile = FrameLayout(this).apply {
                    clipToOutline = true; background = round(Color.BLACK, 12f)
                    addView(ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setImageBitmap(bitmap("thumb-${p.view}")) })
                    addView(View(context).apply { background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Color.TRANSPARENT, Color.argb(200, 0, 0, 0))) })
                    addView(TextView(context).apply {
                        text = "${p.name}\n${p.place}"; textSize = 12f; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD
                        setPadding(px(8f), 0, px(6f), px(6f))
                    }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
                    tag = p.id
                    setOnClickListener { use(p) }
                }
                line.addView(tile, LinearLayout.LayoutParams(0, px(76f), 1f).apply { setMargins(px(4f), px(4f), px(4f), px(4f)) })
                tl += tile
            }
            grid.addView(line)
        }
        tiles = tl

        machineTitle = TextView(this).apply { textSize = 12f; typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD); letterSpacing = 0.3f; text = "THE MACHINE" }
        machineSub = TextView(this).apply { textSize = 15f; setTypeface(Typeface.SERIF, Typeface.ITALIC); text = "its own device, in the kit's look"; setPadding(px(12f), 0, 0, 0) }

        // the machine as the site shows it: its device in its skin's colours, the screen inside, the dials below
        power = View(this).apply { setOnClickListener { if (fm.isPlaying) fm.stop() else fm.power(true); paint() } }
        devName = TextView(this).apply { textSize = 17f; typeface = Typeface.DEFAULT_BOLD }
        meter = Meter(this)
        head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(px(14f), px(12f), px(14f), px(12f))
            addView(power, LinearLayout.LayoutParams(px(24f), px(24f)))
            addView(devName, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = px(12f) })
            addView(meter, LinearLayout.LayoutParams(px(64f), px(12f)))
        }
        // tall: the machine lays its own screen out to fill the box (fitScreen), so there is plenty to touch
        picture = object : ImageView(this) {
            override fun onMeasure(w: Int, h: Int) { val width = MeasureSpec.getSize(w); setMeasuredDimension(width, width * 4 / 3) }
            override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) { super.onSizeChanged(w, h, ow, oh); fit() }
            override fun onDraw(c: Canvas) { super.onDraw(c); finger?.let { (x, y) -> c.drawCircle(x, y, 34 * dp, ring) } }
        }.apply { scaleType = ImageView.ScaleType.CENTER_CROP; clipToOutline = true }
        touchHint = TextView(this).apply { textSize = 12f; gravity = Gravity.CENTER; text = "Touch and hold the screen to play it"; setPadding(0, px(8f), 0, 0) }
        panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        device = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; clipToOutline = true
            addView(head)
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL; setPadding(px(14f), px(14f), px(14f), px(10f))
                addView(picture); addView(touchHint)
            })
            addView(panel)
        }

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(px(18f), 0, px(18f), px(30f))
            isFocusableInTouchMode = true; descendantFocusability = ViewGroup.FOCUS_BEFORE_DESCENDANTS
            addView(View(context), LinearLayout.LayoutParams(1, (resources.displayMetrics.heightPixels * 0.34f).toInt()))
            addView(where); addView(title); addView(sub)
            addView(buttons, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(18f) })
            addView(grid, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(18f) })
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM
                addView(machineTitle); addView(machineSub)
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(26f); bottomMargin = px(12f) })
            addView(device)
        }
        scroller = ScrollView(this).apply { addView(column); fitsSystemWindows = true }
        root = FrameLayout(this).apply {
            addView(lampOff); addView(lampOn)
            addView(shade.apply { tag = "shade" })
            addView(scroller)
        }
        setContentView(root)

        picture.setOnTouchListener { v, e ->
            val m = machine ?: return@setOnTouchListener false
            if (e.actionMasked == MotionEvent.ACTION_DOWN) v.parent.requestDisallowInterceptTouchEvent(true)   // (the page must not take the finger to scroll)
            val sw = m.screenSize.first.takeIf { it > 0f } ?: (v.width / dp)
            val k = sw / v.width.coerceAtLeast(1)
            val type = when (e.actionMasked) { MotionEvent.ACTION_DOWN -> "pointerdown"; MotionEvent.ACTION_MOVE -> "pointermove"; else -> "pointerup" }
            val down = e.actionMasked != MotionEvent.ACTION_UP && e.actionMasked != MotionEvent.ACTION_CANCEL
            m.pointer(type, e.x * k, e.y * k, down)
            finger = if (down) e.x to e.y else null
            v.invalidate()
            true
        }

        val start = PLACES.firstOrNull { it.id == intent.getStringExtra("place") } ?: PLACES[0]
        use(start, autoplay = intent.getBooleanExtra("autoplay", false))
        main.post(ticker)
    }

    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 6f; color = Color.argb(150, 255, 255, 255) }

    private fun fit() { if (picture.width > 10) machine?.fitScreen(picture.width / dp, picture.height / dp) }

    private fun use(p: Place, autoplay: Boolean = fm.isPlaying) {
        if (p.id == current.id && machine != null) return
        current = p
        skin = Skin(skins.optJSONObject(p.id)?.optJSONObject("vars")?.let { o -> o.keys().asSequence().associateWith { o.optString(it) } } ?: emptyMap())
        lampOff.setImageBitmap(bitmap("${p.view}-p-off")); lampOn.setImageBitmap(bitmap("${p.view}-p-on"))
        machine?.destroy(); machine = null
        panel.removeAllViews(); dials.clear(); texts.clear()
        paint()
        val skinJson = skins.optJSONObject(p.id)?.toString()
        Thread {
            val m = fm.mount(p.id, skin = skinJson)
            val list = m.controls()
            val colors = m.colors
            main.post {
                if (current.id != p.id) { m.destroy(); return@post }
                machine = m
                if (colors.isNotEmpty()) skin = Skin(colors)
                fit()
                build(m, list)
                if (autoplay) fm.power(true)
                paint()
            }
        }.start()
    }

    // everything in the place's colours
    private fun paint() {
        val k = skin
        val page = k.c("page")
        val ink = k.c("page-ink")
        val accent = k.c("accent")
        root.setBackgroundColor(page)
        root.findViewWithTag<View>("shade").background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT, (page and 0x00ffffff) or (0xc0 shl 24), page))
        where.text = "${current.place} · ${current.whenText}".uppercase(); where.setTextColor(accent)
        title.text = current.name.uppercase(); title.setTextColor(ink)
        sub.text = current.sub; sub.setTextColor(ink)
        play.text = if (fm.isPlaying) "❚❚  Pause" else "▶  Play"; play.setTextColor(page); play.background = round(accent, 30f)
        val w = fm.windState
        wind.text = if (w.on) "Ends in about ${w.minutesLeft} min" else if (w.wound) "Wound down. Sleep well." else "Wind down in 1 min"
        wind.setTextColor(ink); wind.background = round(Color.argb(90, 0, 0, 0), 30f, Color.argb(60, 255, 255, 255))
        for (t in tiles) t.foreground = if (t.tag == current.id) round(Color.TRANSPARENT, 12f, accent).apply { setStroke(px(2f), accent) } else null
        machineTitle.setTextColor(accent); machineSub.setTextColor((ink and 0x00ffffff) or (0xb0 shl 24))
        device.background = round(k.c("dev"), 14f, k.c("line"))
        head.setBackgroundColor(k.c("head"))
        power.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (fm.isPlaying) k.c("accent") else k.c("dim")) }
        devName.text = current.name; devName.setTextColor(k.c("ink"))
        meter.on = k.c("accent2"); meter.off = k.c("track")
        picture.background = round(k.c("screen"), 10f, k.c("line"))
        touchHint.setTextColor(k.c("dim"))
    }

    // the controls, in the machine's own sections: dials four to a row, then menus, switches, buttons, readouts
    private fun build(m: FMMachine, list: List<FMControl>) {
        val k = skin
        val bySection = LinkedHashMap<String, MutableList<FMControl>>()
        for (c in list) if (c.kind != "steps") bySection.getOrPut(c.section) { mutableListOf() } += c
        for ((name, cs) in bySection) {
            panel.addView(View(this).apply { setBackgroundColor(k.c("line")) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(1f)))
            val sec = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(px(14f), px(12f), px(14f), px(12f)) }
            sec.addView(TextView(this).apply { text = name; textSize = 15f; setTextColor(k.c("dim")); typeface = Typeface.DEFAULT_BOLD })
            val knobs = cs.filter { it.kind == "knob" }
            for (row in knobs.chunked(4)) {
                val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                for (c in row) {
                    val d = Dial(this, k) { v -> m.set(c.key, v.toDouble()) }.apply {
                        label = c.label; value = c.value.toFloat(); text = c.text ?: ""
                        onTouch = { on -> editing = if (on) c.key else null }
                    }
                    dials[c.key] = d
                    line.addView(d, LinearLayout.LayoutParams(0, px(112f), 1f))
                }
                repeat(4 - row.size) { line.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f)) }
                sec.addView(line)
            }
            for (c in cs.filter { it.kind != "knob" }) sec.addView(widget(m, c, k))
            panel.addView(sec)
        }
    }

    private fun widget(m: FMMachine, c: FMControl, k: Skin): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, px(10f), 0, px(4f)) }
        row.addView(TextView(this).apply { text = c.label; textSize = 15f; setTextColor(k.c("ink")) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val value = TextView(this).apply { textSize = 15f; setPadding(px(14f), px(8f), px(14f), px(8f)) }
        when (c.kind) {
            "select" -> {
                value.setTextColor(k.c("field-ink")); value.background = round(k.c("field"), 4f, k.c("line"))
                value.setOnClickListener {
                    PopupMenu(this, value).apply {
                        c.options.forEachIndexed { i, o -> menu.add(0, i, i, o) }
                        setOnMenuItemClickListener { item -> m.set(c.key, if (c.options.size > 1) item.itemId.toDouble() / (c.options.size - 1) else 0.0); true }
                    }.show()
                }
                texts[c.key] = { n -> value.text = "${n.text ?: ""}  ▾" }
            }
            "toggle" -> {
                value.setOnClickListener { m.set(c.key, if ((value.tag as? Boolean) == true) 0.0 else 1.0) }
                texts[c.key] = { n ->
                    val on = n.value > 0.5; value.tag = on
                    value.text = n.text?.takeIf { it.isNotEmpty() } ?: if (on) "On" else "Off"
                    value.setTextColor(if (on) k.c("dev") else k.c("ink")); value.background = round(if (on) k.c("accent2") else k.c("track"), 20f)
                }
            }
            "button" -> {
                value.text = c.text?.takeIf { it.isNotEmpty() } ?: c.label; value.setTextColor(k.c("ink")); value.background = round(k.c("track"), 6f)
                value.setOnClickListener { m.press(c.key) }
            }
            "readout" -> { value.setTextColor(k.c("accent2")); texts[c.key] = { n -> value.text = n.text ?: "" } }
        }
        texts[c.key]?.invoke(c)
        row.addView(value)
        return row
    }

    private val ticker: Runnable = object : Runnable {
        override fun run() {
            machine?.let { m ->
                m.screenBitmap()?.let {
                    val first = picture.drawable == null
                    picture.setImageBitmap(it)
                    if (first) scroller.post {
                        if (intent.getBooleanExtra("dials", false)) scroller.fullScroll(View.FOCUS_DOWN) else scroller.scrollTo(0, 0)   // (dials: for screenshots)
                    }
                }
                if (++ticks % 4 == 0) {
                    level = m.level
                    meter.level = level
                    if (editing == null) for (c in m.controls()) { dials[c.key]?.let { d -> d.value = c.value.toFloat(); d.text = c.text ?: "" }; texts[c.key]?.invoke(c) }
                    if (ticks % 40 == 0) Log.i("FMDEMO", "level=%.3f playing=%s machine=%s lamp=%.2f".format(level, fm.isPlaying, m.name, lamp))
                }
            }
            // the lanterns: on while it plays, dimming as it winds down, out when it is over
            val w = fm.windState
            val target = if (w.wound) 0f else if (!fm.isPlaying) 0.45f else if (w.on) min(1f, 0.08f + w.left.toFloat() * 1.1f) else 1f
            lamp += (min(1f, target * (0.9f + if (fm.isPlaying) min(1f, level) * 0.12f else 0f)) - lamp) * 0.08f
            lampOn.alpha = lamp
            main.postDelayed(this, 66)
        }
    }

    override fun onDestroy() { main.removeCallbacks(ticker); fm.destroy(); super.onDestroy() }
}

// a knob as the kit draws it: a 270° track, the value in the accent, a needle; drag up or down to turn it
@SuppressLint("ViewConstructor")
class Dial(ctx: Context, private val k: Skin, private val onChange: (Float) -> Unit) : View(ctx) {
    var label = ""
    var value = 0f; set(v) { field = v; invalidate() }
    var text = ""; set(v) { field = v; invalidate() }
    var onTouch: (Boolean) -> Unit = {}
    private val d = ctx.resources.displayMetrics.density
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 5 * d; strokeCap = Paint.Cap.ROUND }
    private val needle = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = 2.5f * d; strokeCap = Paint.Cap.ROUND }
    private val type = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; textSize = 14 * d }
    private var from = 0f; private var y0 = 0f

    override fun onDraw(c: Canvas) {
        val cx = width / 2f
        val r = 22 * d
        val cy = 22 * d + r
        type.color = k.c("ink"); c.drawText(label, cx, 16 * d, type)
        val box = RectF(cx - r, cy - r, cx + r, cy + r)
        arc.color = k.c("track"); c.drawArc(box, 135f, 270f, false, arc)
        arc.color = k.c("accent2"); c.drawArc(box, 135f, 270f * value, false, arc)
        val a = Math.toRadians((135 + 270 * value).toDouble())
        needle.color = k.c("ink")
        c.drawLine(cx + (r * 0.25f) * Math.cos(a).toFloat(), cy + (r * 0.25f) * Math.sin(a).toFloat(), cx + (r * 0.7f) * Math.cos(a).toFloat(), cy + (r * 0.7f) * Math.sin(a).toFloat(), needle)
        c.drawText(text, cx, cy + r + 22 * d, type)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { parent.requestDisallowInterceptTouchEvent(true); from = value; y0 = e.y; onTouch(true) }
            MotionEvent.ACTION_MOVE -> { value = max(0f, min(1f, from - (e.y - y0) / (180 * d))); onChange(value) }
            else -> onTouch(false)
        }
        return true
    }
}

// the level, as the kit's header shows it: a row of small bars
class Meter(ctx: Context) : View(ctx) {
    var level = 0f; set(v) { field = v; invalidate() }
    var on = Color.GREEN; var off = Color.DKGRAY
    private val p = Paint()
    override fun onDraw(c: Canvas) {
        val n = 14; val w = width / n.toFloat()
        for (i in 0 until n) { p.color = if (i / n.toFloat() < min(1f, level)) on else off; c.drawRect(i * w, 0f, i * w + w * 0.7f, height.toFloat(), p) }
    }
}
