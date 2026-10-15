#!/usr/bin/env python3
"""Writes save-to-pinned.plist, the unsigned "Save to Pinned" shortcut.

Run from anywhere:  python3 extras/shortcut/build.py --sign
Without --sign it only writes the plist.

Key names and value shapes follow the Cherri compiler and shortcuts-js,
both listed in README.md.
"""
import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "save-to-pinned.plist"
OBJ = "￼"  # Shortcuts marks an inline variable with this character

actions = []


_count = 0


def new_uuid():
    """Stable ids, so a rebuild without changes gives the same plist."""
    global _count
    _count += 1
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "save-to-pinned/%d" % _count)).upper()


def add(ident, params=None, output=None):
    """Append an action. Returns a reference to its output when `output` names it."""
    p = dict(params or {})
    ref = None
    if output:
        u = new_uuid()
        p["UUID"] = u
        p["CustomOutputName"] = output
        ref = {"Type": "ActionOutput", "OutputUUID": u, "OutputName": output}
    actions.append({"WFWorkflowActionIdentifier": "is.workflow.actions." + ident,
                    "WFWorkflowActionParameters": p})
    return ref


def var(name):
    return {"Type": "Variable", "VariableName": name}


SHORTCUT_INPUT = {"Type": "ExtensionInput"}
REPEAT_ITEM = var("Repeat Item")


def attach(ref):
    return {"Value": ref, "WFSerializationType": "WFTextTokenAttachment"}


def text(*parts):
    """A text field. Parts are plain strings or variable references."""
    s, ranges = "", {}
    for part in parts:
        if isinstance(part, str):
            s += part
        else:
            pos = len(s.encode("utf-16-le")) // 2
            ranges["{%d, 1}" % pos] = part
            s += OBJ
    return {"Value": {"string": s, "attachmentsByRange": ranges},
            "WFSerializationType": "WFTextTokenString"}


def dictionary(items):
    """items: list of (key, item_type, value) with item_type 0 text, 3 number."""
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFItemType": t, "WFKey": text(k), "WFValue": v} for k, t, v in items]},
        "WFSerializationType": "WFDictionaryFieldValue"}


def condition_input(ref):
    return {"Type": "Variable", "Variable": attach(ref)}


class Block:
    """If or Repeat with Each. Control flow mode 0 start, 1 otherwise, 2 end."""

    def __init__(self, ident, params):
        self.ident, self.group = ident, new_uuid()
        add(ident, dict(params, GroupingIdentifier=self.group, WFControlFlowMode=0))

    def otherwise(self):
        add(self.ident, {"GroupingIdentifier": self.group, "WFControlFlowMode": 1})

    def end(self):
        add(self.ident, {"GroupingIdentifier": self.group, "WFControlFlowMode": 2})


IS, CONTAINS, HAS_VALUE, NO_VALUE = 4, 99, 100, 101


def if_(ref, cond, value=None):
    p = {"WFInput": condition_input(ref), "WFCondition": cond}
    if value is not None:
        p["WFConditionalActionString"] = value
    return Block("conditional", p)


def notify(*parts):
    add("notification", {"WFNotificationActionTitle": "Pinned",
                         "WFNotificationActionBody": text(*parts),
                         "WFNotificationActionSound": False})


def set_var(name, ref):
    add("setvariable", {"WFVariableName": name, "WFInput": attach(ref)})


def value_for_key(ref, key, output):
    return add("getvalueforkey", {"WFInput": attach(ref), "WFDictionaryKey": key,
                                  "WFGetDictionaryValueType": "Value"}, output)


def request(method, url_parts, body=None, output="Response"):
    headers = [("Authorization", 0, text("Bearer ", var("Token"))),
               ("X-Requested-With", 0, text("fetch"))]
    p = {"WFURL": text(*url_parts), "WFHTTPMethod": method, "ShowHeaders": True,
         "WFHTTPHeaders": dictionary(headers)}
    if body is not None:
        p["Advanced"] = True
        p["WFHTTPBodyType"] = "JSON"
        p["WFJSONValues"] = dictionary(body)
    return add("downloadurl", p, output)


# 1. The two answers given when the shortcut is added. Import questions point
#    at these two Text actions by index, so they must stay first and third.
address_text = add("gettext", {"WFTextActionText": ""}, "Address answer")          # index 0
address = add("text.replace", {"WFInput": text(address_text), "WFReplaceTextFind": "/+$",
                               "WFReplaceTextReplace": "", "WFReplaceTextRegularExpression": True},
              "Address")                                                           # index 1
set_var("Address", address)                                                        # index 2
token_text = add("gettext", {"WFTextActionText": ""}, "Token answer")              # index 3
token = add("text.trimwhitespace", {"WFInput": text(token_text)}, "Token")
set_var("Token", token)

# 2. The link: from the share sheet, or the clipboard when run on its own.
urls = add("detect.link", {"WFInput": attach(SHORTCUT_INPUT)}, "URLs")
first = add("getitemfromlist", {"WFInput": attach(urls), "WFItemSpecifier": "First Item"}, "URL")
set_var("URL", first)
b = if_(var("URL"), NO_VALUE)
notify("No link to save. Copy a link first, or share a page.")
add("exit")
b.end()

# 3. The title, only when Safari shares a web page. Otherwise it stays empty
#    and the app uses the host.
kind = add("getitemtype", {"WFInput": attach(SHORTCUT_INPUT)}, "Type")
b = if_(kind, CONTAINS, "Safari")
name = add("properties.safariwebpage", {"WFInput": attach(SHORTCUT_INPUT),
                                        "WFContentItemPropertyName": "Name"}, "Page name")
set_var("Title", name)
b.end()

# 4. Save to Inbox first. Choose from List stops the whole shortcut on Cancel,
#    so saving first is the only way Cancel can still leave the link in Inbox.
saved = request("POST", [var("Address"), "/api/bookmarks"],
                [("url", 0, text(var("URL"))), ("title", 0, text(var("Title")))], "Save response")
new_id = value_for_key(saved, "id", "Saved id")
b = if_(new_id, NO_VALUE)
err = value_for_key(saved, "error", "Save error")
dup = if_(err, CONTAINS, "Already saved")
notify("Already saved")
dup.otherwise()
known = if_(err, HAS_VALUE)
notify(err)
known.otherwise()
notify("Could not save. Check the address and the token in the shortcut.")
known.end()
dup.end()
add("exit")
b.end()
set_var("Bookmark", new_id)

# 5. One list: Inbox, then every folder by name.
folders = request("GET", [var("Address"), "/api/folders"], output="Folders")
inbox = add("gettext", {"WFTextActionText": "Inbox"}, "Inbox")
set_var("Names", inbox)
loop = Block("repeat.each", {"WFInput": attach(folders)})
fname = value_for_key(REPEAT_ITEM, "name", "Folder name")
add("appendvariable", {"WFVariableName": "Names", "WFInput": attach(fname)})
loop.end()
chosen = add("choosefromlist", {"WFInput": attach(var("Names")),
                                "WFChooseFromListActionPrompt": "Save to"}, "Chosen")
set_var("Folder", chosen)

b = if_(var("Folder"), IS, "Inbox")
notify("Saved to Inbox")
add("exit")
b.end()

# 6. Find the id of the chosen folder and move the bookmark there.
loop = Block("repeat.each", {"WFInput": attach(folders)})
fname = value_for_key(REPEAT_ITEM, "name", "Folder name")
match = if_(fname, IS, text(var("Folder")))
fid = value_for_key(REPEAT_ITEM, "id", "Folder id")
set_var("Folder ID", fid)
match.end()
loop.end()

moved = request("PATCH", [var("Address"), "/api/bookmarks/", var("Bookmark")],
                [("folder_id", 3, text(var("Folder ID")))], "Move response")
moved_id = value_for_key(moved, "id", "Moved id")
b = if_(moved_id, HAS_VALUE)
notify("Saved to ", var("Folder"))
b.otherwise()
merr = value_for_key(moved, "error", "Move error")
notify("Saved to Inbox. Moving it failed: ", merr)
b.end()

shortcut = {
    "WFWorkflowActions": actions,
    "WFWorkflowClientVersion": "2607.0.2",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863,      # blue
                       "WFWorkflowIconGlyphNumber": 59670},       # bookmark
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowInputContentItemClasses": ["WFURLContentItem", "WFSafariWebPageContentItem"],
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowNoInputBehavior": {"Name": "WFWorkflowNoInputBehaviorGetClipboard",
                                  "Parameters": {}},
    "WFQuickActionSurfaces": [],
    "WFWorkflowImportQuestions": [
        {"ActionIndex": 0, "Category": "Parameter", "ParameterKey": "WFTextActionText",
         "Text": "Address of your Pinned server, like https://bookmarks.example.com",
         "DefaultValue": ""},
        {"ActionIndex": 3, "Category": "Parameter", "ParameterKey": "WFTextActionText",
         "Text": "API token (create one under API tokens in the app)",
         "DefaultValue": ""},
    ],
}

with OUT.open("wb") as f:
    plistlib.dump(shortcut, f, fmt=plistlib.FMT_XML, sort_keys=True)
print(f"wrote {OUT} ({len(actions)} actions)")

# Signing needs macOS. `shortcuts sign` only reads the binary plist form
# with a .shortcut name, so write that to a temporary folder first.
if "--sign" in sys.argv:
    signed = HERE.parent.parent / "web" / "extras" / "save-to-pinned.shortcut"
    with tempfile.TemporaryDirectory() as tmp:
        unsigned = Path(tmp) / "save-to-pinned.shortcut"
        with unsigned.open("wb") as f:
            plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY, sort_keys=True)
        subprocess.run(["shortcuts", "sign", "--mode", "anyone",
                        "--input", str(unsigned), "--output", str(signed)], check=True)
    print(f"signed {signed} ({signed.stat().st_size} bytes)")
