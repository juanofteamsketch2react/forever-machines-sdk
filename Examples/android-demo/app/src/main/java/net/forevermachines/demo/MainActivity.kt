package net.forevermachines.demo

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.Switch
import android.widget.TextView
import net.forevermachines.sdk.FMControl
import net.forevermachines.sdk.FMMachine
import net.forevermachines.sdk.FMSession

class MainActivity : Activity() {
    private lateinit var fm: FMSession
    private var machine: FMMachine? = null
    private val main = Handler(Looper.getMainLooper())
    private lateinit var picture: ImageView
    private lateinit var meter: ProgressBar
    private lateinit var play: Button
    private lateinit var panel: LinearLayout
    private lateinit var scroller: ScrollView
    private val values = mutableMapOf<String, (FMControl) -> Unit>()   // key → refresh its view
    private var editing: String? = null
    private var ticks = 0
    private val names = listOf("slow-tide", "night-choir", "seven-bowls", "lotus-pond", "rain-window", "long-breath")
    private val titles = listOf("Slow Tide", "Night Choir", "Seven Bowls", "Lotus Pond", "Rain Window", "Long Breath")
    private val places = listOf("The beach", "The sala", "The table", "The pond", "The hut", "The lookout")
    private var tileRow: LinearLayout? = null

    @SuppressLint("ClickableViewAccessibility")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        fm = FMSession(this)
        val dp = resources.displayMetrics.density
        // tall: the machine lays its own screen out to fill the box (fitScreen), so there is plenty to touch
        picture = object : ImageView(this) {
            override fun onMeasure(w: Int, h: Int) {
                val width = MeasureSpec.getSize(w)
                setMeasuredDimension(width, width * 4 / 3)
            }
            override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) { super.onSizeChanged(w, h, ow, oh); fit() }
        }.apply { scaleType = ImageView.ScaleType.CENTER_CROP; clipToOutline = true }
        play = Button(this)
        val wind = Button(this).apply { text = "Wind down in 1 min" }
        meter = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }
        // the places, as tiles in a row: a tap switches, and it plays on if it was playing
        val tiles = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for ((i, id) in names.withIndex()) {
            tiles.addView(Button(this).apply {
                text = "${titles[i]}\n${places[i]}"; isAllCaps = false; tag = id
                minWidth = (150 * dp).toInt(); minHeight = (72 * dp).toInt()
                setOnClickListener { use(id, autoplay = fm.isPlaying) }
            })
        }
        tileRow = tiles
        val place = android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(tiles) }
        panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding((16 * dp).toInt(), (16 * dp).toInt(), (16 * dp).toInt(), (16 * dp).toInt())
            addView(picture); addView(place); addView(play); addView(wind); addView(meter); addView(panel)
            isFocusableInTouchMode = true   // (takes the first focus, so the page opens at the top, not at a slider)
            descendantFocusability = android.view.ViewGroup.FOCUS_BEFORE_DESCENDANTS
        }
        scroller = ScrollView(this).apply { addView(column); fitsSystemWindows = true }   // (Android 15 draws edge to edge)
        setContentView(scroller)

        fun label() { play.text = if (fm.isPlaying) "Pause" else "Play" }
        play.setOnClickListener { if (fm.isPlaying) fm.stop() else fm.power(true); label() }
        wind.setOnClickListener { fm.windDown(1.0); label() }
        fm.onWind = { s -> wind.text = if (s.on) "Winding down: ${s.minutesLeft} min" else if (s.wound) "Wound down" else "Wind down in 1 min"; label() }
        label()
        // the machine's own screen, played with a finger
        picture.setOnTouchListener { v, e ->
            val m = machine ?: return@setOnTouchListener false
            val k = m.screenSize.first / v.width.coerceAtLeast(1)
            val type = when (e.actionMasked) { MotionEvent.ACTION_DOWN -> "pointerdown"; MotionEvent.ACTION_MOVE -> "pointermove"; else -> "pointerup" }
            m.pointer(type, e.x * k, e.y * k, e.actionMasked != MotionEvent.ACTION_UP && e.actionMasked != MotionEvent.ACTION_CANCEL)
            true
        }
        use("slow-tide", autoplay = intent.getBooleanExtra("autoplay", false))
        main.post(ticker)
    }

    private fun fit() {
        val d = resources.displayMetrics.density
        if (picture.width > 10) machine?.fitScreen(picture.width / d, picture.height / d)
    }

    private var current = ""
    private fun use(name: String, autoplay: Boolean = false) {
        if (name == current) return
        current = name
        tileRow?.let { row -> for (i in 0 until row.childCount) row.getChildAt(i).alpha = if (row.getChildAt(i).tag == name) 1f else 0.55f }
        machine?.destroy(); machine = null
        panel.removeAllViews(); values.clear()
        Thread {
            val m = fm.mount(name)
            val list = m.controls()
            main.post {
                machine = m
                fit()
                build(m, list)
                if (autoplay) { fm.power(true); play.text = "Pause" }
            }
        }.start()
    }

    // the controls, in the machine's own sections
    private fun build(m: FMMachine, list: List<FMControl>) {
        val dp = resources.displayMetrics.density
        var section: String? = null
        for (c in list) {
            if (c.section != section) {
                section = c.section
                panel.addView(TextView(this).apply { text = c.section.uppercase(); setTextColor(Color.GRAY); textSize = 12f; setPadding(0, (18 * dp).toInt(), 0, (4 * dp).toInt()) })
            }
            when (c.kind) {
                "knob" -> {
                    val head = TextView(this)
                    val bar = SeekBar(this).apply { max = 1000; progress = (c.value * 1000).toInt() }
                    bar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                        override fun onProgressChanged(s: SeekBar, p: Int, user: Boolean) { if (user) m.set(c.key, p / 1000.0) }
                        override fun onStartTrackingTouch(s: SeekBar) { editing = c.key }
                        override fun onStopTrackingTouch(s: SeekBar) { editing = null }
                    })
                    values[c.key] = { n -> head.text = "${n.label}   ${n.text ?: ""}"; if (editing != c.key) bar.progress = (n.value * 1000).toInt() }
                    values[c.key]!!(c)
                    panel.addView(head); panel.addView(bar)
                }
                "toggle" -> {
                    val sw = Switch(this).apply { text = c.label; isChecked = c.value > 0.5 }
                    sw.setOnCheckedChangeListener { _, on -> m.set(c.key, if (on) 1.0 else 0.0) }
                    panel.addView(sw)
                }
                "select" -> {
                    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                    val sp = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, c.options) }
                    val n = (c.options.size - 1).coerceAtLeast(1)
                    sp.setSelection(Math.round(c.value * n).toInt())
                    sp.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                        override fun onItemSelected(p: AdapterView<*>?, v: View?, i: Int, id: Long) { m.set(c.key, i.toDouble() / n) }
                        override fun onNothingSelected(p: AdapterView<*>?) {}
                    }
                    row.addView(TextView(this).apply { text = c.label }); row.addView(sp)
                    panel.addView(row)
                }
                "button" -> panel.addView(Button(this).apply { text = c.text?.takeIf { it.isNotEmpty() } ?: c.label; setOnClickListener { m.press(c.key) } })
                "readout" -> {
                    val t = TextView(this)
                    values[c.key] = { n -> t.text = "${n.label}   ${n.text ?: ""}" }
                    values[c.key]!!(c)
                    panel.addView(t)
                }
            }
        }
    }

    private val ticker: Runnable = object : Runnable {
        override fun run() {
            machine?.let { m ->
                m.screenBitmap()?.let {
                    val first = picture.drawable == null
                    picture.setImageBitmap(it)
                    if (first) scroller.post { scroller.scrollTo(0, 0) }   // (the picture arriving late leaves the page scrolled)
                }
                if (++ticks % 4 == 0) {
                    val level = m.level
                    meter.progress = (level * 100).toInt()
                    if (editing == null) for (c in m.controls()) values[c.key]?.invoke(c)
                    if (ticks % 40 == 0) Log.i("FMDEMO", "level=%.3f playing=%s machine=%s controls=%d".format(level, fm.isPlaying, m.name, values.size))
                }
            }
            main.postDelayed(this, 66)
        }
    }

    override fun onDestroy() { main.removeCallbacks(ticker); fm.destroy(); super.onDestroy() }
}
