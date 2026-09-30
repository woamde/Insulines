import os
from typing import List, Union, Optional
import litellm

class ImageContent:
    def __init__(self, image_source: str):
        self.image_source = image_source

class UserMessage:
    def __init__(self, content: Union[str, List[Union[str, ImageContent]]]):
        self.content = content

class LlmChat:
    def __init__(self, model: str = "gpt-4o", api_key: Optional[str] = None, system_message: Optional[str] = None):
        self.model = model
        self.api_key = api_key
        self.system_message = system_message
        self.messages = []
        if system_message:
            self.messages.append({"role": "system", "content": system_message})

    def send_message(self, message: Union[str, UserMessage]) -> str:
        # Formater le message utilisateur (texte et images éventuelles)
        content_payload = []
        if isinstance(message, UserMessage):
            if isinstance(message.content, list):
                for item in message.content:
                    if isinstance(item, ImageContent):
                        content_payload.append({
                            "type": "image_url",
                            "image_url": {"url": item.image_source}
                        })
                    else:
                        content_payload.append({"type": "text", "text": str(item)})
            else:
                content_payload = message.content
        else:
            content_payload = str(message)

        self.messages.append({"role": "user", "content": content_payload})

        # Appel au modèle via litellm
        kwargs = {"model": self.model, "messages": self.messages}
        if self.api_key:
            kwargs["api_key"] = self.api_key

        response = litellm.completion(**kwargs)
        reply = response.choices[0].message.content
        
        self.messages.append({"role": "assistant", "content": reply})
        return reply