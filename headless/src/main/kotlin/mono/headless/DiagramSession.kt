@file:OptIn(ExperimentalJsExport::class)

package mono.headless

import mono.bitmap.manager.MonoBitmapManager
import mono.graphics.board.Highlight
import mono.graphics.board.MonoBoard
import mono.graphics.geo.DirectedPoint
import mono.graphics.geo.Point
import mono.graphics.geo.Rect
import mono.shape.ShapeExtraManager
import mono.shape.ShapeManager
import mono.shape.command.AddShape
import mono.shape.command.ChangeBound
import mono.shape.command.ChangeExtra
import mono.shape.command.ChangeText
import mono.shape.command.GroupShapes
import mono.shape.command.RemoveShape
import mono.shape.command.Ungroup
import mono.shape.connector.ShapeConnector
import mono.shape.extra.LineExtra
import mono.shape.extra.RectangleExtra
import mono.shape.extra.TextExtra
import mono.shape.extra.style.RectangleBorderCornerPattern
import mono.shape.extra.style.StraightStrokeDashPattern
import mono.shape.extra.style.TextAlign
import mono.shape.serialization.SerializableGroup
import mono.shape.serialization.ShapeSerializationUtil
import mono.shape.shape.AbstractShape
import mono.shape.shape.Group
import mono.shape.shape.Line
import mono.shape.shape.Rectangle
import mono.shape.shape.RootGroup
import mono.shape.shape.Text
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * A headless diagram session wrapping MonoSketch's core shape engine.
 * All complex return types use JSON strings to work around @JsExport limitations.
 */
@JsExport
class DiagramSession {
    private val shapeManager = ShapeManager()
    private val bitmapManager = MonoBitmapManager()
    private val board = MonoBoard()

    init {
        initNodeCompat()
    }

    // ---- Shape Creation ----

    fun addRectangle(
        left: Int,
        top: Int,
        width: Int,
        height: Int,
        fillStyleId: String? = null,
        borderStyleId: String? = null,
        isRoundedCorner: Boolean = false
    ): String {
        val rect = Rect.byLTWH(left, top, maxOf(width, 1), maxOf(height, 1))
        val shape = Rectangle(rect)
        val extra = buildRectangleExtra(fillStyleId, borderStyleId, isRoundedCorner)
        shape.setExtra(extra)
        shapeManager.execute(AddShape(shape))
        return shape.id
    }

    fun addText(
        left: Int,
        top: Int,
        width: Int,
        height: Int,
        text: String,
        horizontalAlign: String = "MIDDLE",
        verticalAlign: String = "MIDDLE",
        fillStyleId: String? = null,
        borderStyleId: String? = null
    ): String {
        val rect = Rect.byLTWH(left, top, maxOf(width, 1), maxOf(height, 1))
        val shape = Text(rect)
        shapeManager.execute(AddShape(shape))

        // Set text content
        shapeManager.execute(ChangeText(shape, text))

        // Set styling
        val hAlign = TextAlign.HorizontalAlign.valueOf(horizontalAlign)
        val vAlign = TextAlign.VerticalAlign.valueOf(verticalAlign)
        val rectExtra = buildRectangleExtra(fillStyleId, borderStyleId, false)
        val textExtra = TextExtra(rectExtra, TextAlign(hAlign, vAlign))
        shapeManager.execute(ChangeExtra(shape, textExtra))

        return shape.id
    }

    fun addLine(
        startX: Int,
        startY: Int,
        startDirection: String,
        endX: Int,
        endY: Int,
        endDirection: String,
        strokeStyleId: String? = null,
        startAnchorId: String? = null,
        endAnchorId: String? = null,
        isRoundedCorner: Boolean = false
    ): String {
        val startDir = DirectedPoint.Direction.valueOf(startDirection)
        val endDir = DirectedPoint.Direction.valueOf(endDirection)
        val startPoint = DirectedPoint(startDir, startX, startY)
        val endPoint = DirectedPoint(endDir, endX, endY)

        val shape = Line(startPoint, endPoint)

        val strokeStyle = ShapeExtraManager.getLineStrokeStyle(strokeStyleId)
        val startAnchor = ShapeExtraManager.getStartHeadAnchorChar(startAnchorId)
        val endAnchor = ShapeExtraManager.getEndHeadAnchorChar(endAnchorId)

        val extra = LineExtra(
            isStrokeEnabled = true,
            userSelectedStrokeStyle = strokeStyle,
            isStartAnchorEnabled = startAnchorId != null,
            userSelectedStartAnchor = startAnchor,
            isEndAnchorEnabled = endAnchorId != null,
            userSelectedEndAnchor = endAnchor,
            dashPattern = StraightStrokeDashPattern.SOLID,
            isRoundedCorner = isRoundedCorner
        )
        shape.setExtra(extra)

        shapeManager.execute(AddShape(shape))
        return shape.id
    }

    // ---- Shape Editing ----

    fun moveShape(shapeId: String, newLeft: Int, newTop: Int) {
        val shape = requireShape(shapeId)
        val newBound = Rect.byLTWH(newLeft, newTop, shape.bound.width, shape.bound.height)
        shapeManager.execute(ChangeBound(shape, newBound))
    }

    fun resizeShape(shapeId: String, newWidth: Int, newHeight: Int) {
        val shape = requireShape(shapeId)
        val newBound = Rect.byLTWH(
            shape.bound.left,
            shape.bound.top,
            maxOf(newWidth, 1),
            maxOf(newHeight, 1)
        )
        shapeManager.execute(ChangeBound(shape, newBound))
    }

    fun updateText(shapeId: String, text: String) {
        val shape = shapeManager.getShape(shapeId) as? Text
            ?: error("Text shape not found: $shapeId")
        shapeManager.execute(ChangeText(shape, text))
    }

    fun deleteShape(shapeId: String) {
        val shape = requireShape(shapeId)
        shapeManager.execute(RemoveShape(shape))
    }

    fun groupShapes(shapeIds: Array<String>): String {
        val shapes = shapeIds.map { requireShape(it) }
        // Collect existing IDs before grouping to find the new group after
        val existingIds = mutableSetOf<String>()
        collectShapes(shapeManager.root) { existingIds.add(it.id) }
        existingIds.add(shapeManager.root.id)

        shapeManager.execute(GroupShapes(shapes))

        // Find the new group by diffing IDs
        val newIds = mutableSetOf<String>()
        collectShapes(shapeManager.root) { newIds.add(it.id) }
        newIds.add(shapeManager.root.id)
        val addedIds = newIds - existingIds
        return addedIds.firstOrNull() ?: error("No new group created")
    }

    fun ungroupShape(groupId: String) {
        val group = shapeManager.getShape(groupId) as? Group
            ?: error("Group not found: $groupId")
        shapeManager.execute(Ungroup(group))
    }

    // ---- Query ----

    fun listShapes(): String {
        val shapes = buildJsonArray {
            collectShapes(shapeManager.root) { shape ->
                add(shapeToJson(shape))
            }
        }
        return shapes.toString()
    }

    fun getShape(shapeId: String): String {
        val shape = requireShape(shapeId)
        return shapeToJson(shape).toString()
    }

    // ---- Rendering ----

    fun render(left: Int = -1, top: Int = -1, width: Int = -1, height: Int = -1): String {
        val allShapes = mutableListOf<AbstractShape>()
        collectShapes(shapeManager.root) { allShapes.add(it) }

        if (allShapes.isEmpty()) return ""

        val renderBound = if (left < 0 || top < 0 || width < 0 || height < 0) {
            // Auto-bounds with 1-char padding
            val minLeft = allShapes.minOf { it.bound.left } - 1
            val minTop = allShapes.minOf { it.bound.top } - 1
            val maxRight = allShapes.maxOf { it.bound.right } + 1
            val maxBottom = allShapes.maxOf { it.bound.bottom } + 1
            Rect.byLTRB(minLeft, minTop, maxRight, maxBottom)
        } else {
            Rect.byLTWH(left, top, minOf(width, 200), minOf(height, 200))
        }

        board.clearAndSetWindow(renderBound)

        for (shape in allShapes) {
            val bitmap = bitmapManager.getBitmap(shape) ?: continue
            board.fill(shape.bound.position, bitmap, Highlight.NO)
        }

        return board.toStringInBound(renderBound)
    }

    // ---- Import/Export ----

    fun exportJson(): String {
        @Suppress("USELESS_CAST")
        val serializableRoot = shapeManager.root.toSerializableShape(isIdIncluded = true)
            as SerializableGroup
        return ShapeSerializationUtil.toMonoFileJson(
            name = "Headless Diagram",
            serializableShape = serializableRoot,
            connectors = emptyList(),
            offset = Point.ZERO
        )
    }

    fun importJson(json: String) {
        val monoFile = ShapeSerializationUtil.fromMonoFileJson(json)
            ?: error("Invalid MonoFile JSON")
        val newRoot = RootGroup(monoFile.root)
        shapeManager.replaceRoot(newRoot, ShapeConnector())
    }

    // ---- Private Helpers ----

    private fun requireShape(shapeId: String): AbstractShape =
        shapeManager.getShape(shapeId) ?: error("Shape not found: $shapeId")

    private fun collectShapes(group: Group, action: (AbstractShape) -> Unit) {
        for (item in group.items) {
            action(item)
            if (item is Group) {
                collectShapes(item, action)
            }
        }
    }

    private fun shapeToJson(shape: AbstractShape): JsonObject = buildJsonObject {
        put("id", shape.id)
        put(
            "type",
            when (shape) {
                is Rectangle -> "rectangle"
                is Text -> "text"
                is Line -> "line"
                is Group -> "group"
                else -> "unknown"
            }
        )
        put(
            "bound",
            buildJsonObject {
                put("left", shape.bound.left)
                put("top", shape.bound.top)
                put("width", shape.bound.width)
                put("height", shape.bound.height)
            }
        )
        if (shape is Text) {
            put("text", shape.text)
        }
    }

    private fun buildRectangleExtra(
        fillStyleId: String?,
        borderStyleId: String?,
        isRoundedCorner: Boolean
    ): RectangleExtra {
        val hasFill = fillStyleId != null
        val hasBorder = borderStyleId != null || !hasFill // default: border on if no fill

        return RectangleExtra(
            isFillEnabled = hasFill,
            userSelectedFillStyle = ShapeExtraManager.getRectangleFillStyle(fillStyleId),
            isBorderEnabled = hasBorder,
            userSelectedBorderStyle = ShapeExtraManager.getRectangleBorderStyle(borderStyleId),
            dashPattern = StraightStrokeDashPattern.SOLID,
            corner = if (isRoundedCorner) {
                RectangleBorderCornerPattern.ENABLED
            } else {
                RectangleBorderCornerPattern.DISABLED
            }
        )
    }
}
