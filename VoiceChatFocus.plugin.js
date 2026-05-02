/**
 * @name Voice Chat Focus
 * @version 1.0.0
 * @author Z'ark Ashveil
 * @authorId 262113677900120065
 * @authorLink https://github.com/Kawtious
 * @description Focuses on a user's voice by muting everyone else
 * @source https://github.com/Kawtious/VoiceChatFocus
 * @updateUrl https://raw.githubusercontent.com/Kawtious/VoiceChatFocus/main/VoiceChatFocus.plugin.js
 */

module.exports = class VoiceChatFocus {
    PLUGIN_ID = "VoiceChatFocus";

    UserStore = BdApi.Webpack.Stores.UserStore;
    VoiceStateStore = BdApi.Webpack.Stores.VoiceStateStore;
    MediaEngineStore = BdApi.Webpack.Stores.MediaEngineStore;

    Dispatcher = this.UserStore._dispatcher;

    constructor() {
        this.focusedUserId = null;
    }

    start() {
        this.unpatch = BdApi.ContextMenu.patch("user-context", (element, context) => {
            const myId = this.UserStore.getCurrentUser().id;

            // Return if you're right-clicking yourself
            if (myId === context.user.id) return;

            const myVoiceState = this.VoiceStateStore.getVoiceStateForUser(myId);
            const userVoiceState = this.VoiceStateStore.getVoiceStateForUser(context.user.id);

            // Check if both you and the other user are in a voice channel 
            if (!myVoiceState || !userVoiceState) return;

            // Only show if in same voice channel
            if (myVoiceState.channelId !== userVoiceState.channelId) return;

            // TODO: Is there a better way to do this?
            //  Supposedly there was a hint here, but these links do not work anymore...
            //  https://docs.betterdiscord.app/api/utils#findintree
            //  https://docs.betterdiscord.app/plugins/advanced/react#tree-traversal
            const menu = element.props.children[0].props.children[4].props.children[0];

            menu.push(
                BdApi.ContextMenu.buildItem(
                    {
                        label: this.focusedUserId !== context.user.id ? "Focus User" : "Unfocus User",
                        action: () => this.onFocusButtonClick(userVoiceState.channelId, context.user.id)
                    }
                )
            );
        });
    }

    stop() {
        this.unpatch?.();
    }

    onFocusButtonClick(channelId, userId) {
        const channelVoiceStates = this.VoiceStateStore.getVoiceStatesForChannel(channelId);

        // User will be unfocused
        if (this.focusedUserId === userId) {
            this.focusedUserId = null;
            this.unfocus(channelVoiceStates, userId);
            return;
        }

        this.focusedUserId = userId;
        this.focus(channelVoiceStates, userId);
    }

    focus(voiceStates, userId) {
        Object.values(voiceStates).forEach(state => {
            const isUserMuted = state.userId in this.MediaEngineStore.getSettings().localMutes;

            // If the user is not the focused user but is already muted 
            if (state.userId !== userId && isUserMuted) return;

            // If the user is the focused user but isn't muted
            if (state.userId === userId && !isUserMuted) return;

            this.Dispatcher.dispatch({
                type: "AUDIO_TOGGLE_LOCAL_MUTE",
                userId: state.userId
            });
        });
    }

    unfocus(voiceStates, userId) {
        Object.values(voiceStates).forEach(state => {
            if (state.userId === userId) return;

            const isUserMuted = state.userId in this.MediaEngineStore.getSettings().localMutes;

            if (!isUserMuted) return;

            this.Dispatcher.dispatch({
                type: "AUDIO_TOGGLE_LOCAL_MUTE",
                userId: state.userId
            });
        });
    }
};
