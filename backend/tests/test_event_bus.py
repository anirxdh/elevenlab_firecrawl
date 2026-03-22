"""Comprehensive tests for the EventBus pub/sub system."""

import asyncio
import json

import pytest

from backend.services.event_bus import EventBus, event_bus


# ── EventBus class tests ────────────────────────────────────────────────────


class TestEventBusSubscribe:
    """Test EventBus subscribe and unsubscribe behavior."""

    def test_subscribe_returns_queue(self):
        """subscribe() should return an asyncio.Queue."""
        bus = EventBus()
        q = bus.subscribe()
        assert isinstance(q, asyncio.Queue)

    def test_multiple_subscribes_return_different_queues(self):
        """Each subscribe() call should return a distinct queue."""
        bus = EventBus()
        q1 = bus.subscribe()
        q2 = bus.subscribe()
        assert q1 is not q2

    def test_unsubscribe_removes_queue(self):
        """unsubscribe() should remove the queue from the subscriber list."""
        bus = EventBus()
        q = bus.subscribe()
        assert len(bus._subscribers) == 1
        bus.unsubscribe(q)
        assert len(bus._subscribers) == 0

    def test_unsubscribe_only_removes_target_queue(self):
        """unsubscribe() should only remove the specified queue, not others."""
        bus = EventBus()
        q1 = bus.subscribe()
        q2 = bus.subscribe()
        q3 = bus.subscribe()
        assert len(bus._subscribers) == 3
        bus.unsubscribe(q2)
        assert len(bus._subscribers) == 2
        assert q1 in bus._subscribers
        assert q2 not in bus._subscribers
        assert q3 in bus._subscribers

    def test_unsubscribe_nonexistent_queue_is_safe(self):
        """unsubscribe() with a queue that was never subscribed should not raise."""
        bus = EventBus()
        foreign_queue = asyncio.Queue()
        bus.unsubscribe(foreign_queue)  # Should not raise
        assert len(bus._subscribers) == 0


class TestEventBusEmit:
    """Test EventBus emit behavior."""

    @pytest.mark.asyncio
    async def test_emit_sends_to_subscriber(self):
        """emit() should put an event payload into all subscriber queues."""
        bus = EventBus()
        q = bus.subscribe()

        await bus.emit("status", {"stage": "transcribing"})

        assert not q.empty()
        payload = await q.get()
        assert payload["event"] == "status"
        # Data should be JSON-serialized when it's a dict
        assert json.loads(payload["data"]) == {"stage": "transcribing"}

    @pytest.mark.asyncio
    async def test_emit_sends_to_multiple_subscribers(self):
        """emit() should broadcast the event to all subscribers."""
        bus = EventBus()
        q1 = bus.subscribe()
        q2 = bus.subscribe()
        q3 = bus.subscribe()

        await bus.emit("test_event", {"msg": "hello"})

        for q in [q1, q2, q3]:
            assert not q.empty()
            payload = await q.get()
            assert payload["event"] == "test_event"
            assert json.loads(payload["data"]) == {"msg": "hello"}

    @pytest.mark.asyncio
    async def test_emit_with_string_data(self):
        """emit() with string data should pass it through as-is."""
        bus = EventBus()
        q = bus.subscribe()

        await bus.emit("info", "plain string data")

        payload = await q.get()
        assert payload["event"] == "info"
        assert payload["data"] == "plain string data"

    @pytest.mark.asyncio
    async def test_emit_with_empty_string_data(self):
        """emit() with default empty string data should work."""
        bus = EventBus()
        q = bus.subscribe()

        await bus.emit("ping")

        payload = await q.get()
        assert payload["event"] == "ping"
        assert payload["data"] == ""

    @pytest.mark.asyncio
    async def test_emit_with_no_subscribers_does_not_raise(self):
        """emit() with no subscribers should not raise any exception."""
        bus = EventBus()
        # Should not raise
        await bus.emit("test", {"data": "ignored"})

    @pytest.mark.asyncio
    async def test_emit_preserves_event_order(self):
        """Multiple emit calls should deliver events in order."""
        bus = EventBus()
        q = bus.subscribe()

        await bus.emit("event1", {"order": 1})
        await bus.emit("event2", {"order": 2})
        await bus.emit("event3", {"order": 3})

        p1 = await q.get()
        p2 = await q.get()
        p3 = await q.get()

        assert p1["event"] == "event1"
        assert p2["event"] == "event2"
        assert p3["event"] == "event3"

    @pytest.mark.asyncio
    async def test_unsubscribed_queue_does_not_receive_events(self):
        """After unsubscribe, the queue should not receive new events."""
        bus = EventBus()
        q = bus.subscribe()
        bus.unsubscribe(q)

        await bus.emit("test", {"after": "unsubscribe"})

        assert q.empty()


class TestEventDataFormat:
    """Test the format of event payloads."""

    @pytest.mark.asyncio
    async def test_payload_has_event_and_data_keys(self):
        """Each payload should have 'event' and 'data' keys."""
        bus = EventBus()
        q = bus.subscribe()

        await bus.emit("status", {"stage": "done"})

        payload = await q.get()
        assert "event" in payload
        assert "data" in payload

    @pytest.mark.asyncio
    async def test_dict_data_is_json_serialized(self):
        """When data is a dict, it should be JSON-serialized to a string."""
        bus = EventBus()
        q = bus.subscribe()

        data = {"stage": "understanding", "extra": 42}
        await bus.emit("status", data)

        payload = await q.get()
        assert isinstance(payload["data"], str)
        parsed = json.loads(payload["data"])
        assert parsed == data

    @pytest.mark.asyncio
    async def test_string_data_is_not_double_serialized(self):
        """When data is already a string, it should NOT be JSON-serialized again."""
        bus = EventBus()
        q = bus.subscribe()

        await bus.emit("info", "already a string")

        payload = await q.get()
        assert payload["data"] == "already a string"

    @pytest.mark.asyncio
    async def test_nested_dict_data_is_properly_serialized(self):
        """Nested dict data should be fully JSON-serialized."""
        bus = EventBus()
        q = bus.subscribe()

        nested_data = {
            "stage": "task_complete",
            "result": {
                "type": "steps",
                "actions": [{"action": "click", "selector": "#btn"}],
            },
        }
        await bus.emit("status", nested_data)

        payload = await q.get()
        parsed = json.loads(payload["data"])
        assert parsed["result"]["actions"][0]["selector"] == "#btn"


# ── Singleton tests ──────────────────────────────────────────────────────────


class TestEventBusSingleton:
    """Test that the module-level event_bus singleton works correctly."""

    def test_singleton_is_event_bus_instance(self):
        """The module-level event_bus should be an EventBus instance."""
        assert isinstance(event_bus, EventBus)

    @pytest.mark.asyncio
    async def test_singleton_can_emit_and_receive(self):
        """The singleton event_bus should support emit and subscribe."""
        q = event_bus.subscribe()
        try:
            await event_bus.emit("singleton_test", {"key": "value"})
            payload = await q.get()
            assert payload["event"] == "singleton_test"
        finally:
            event_bus.unsubscribe(q)
